/** Shared native-offline/server/review contracts. These do not authorize or persist writes. */
export type SyncJsonValue =
  | null | boolean | number | string
  | readonly SyncJsonValue[]
  | { readonly [key: string]: SyncJsonValue };
export type SyncRecord = Readonly<Record<string, SyncJsonValue>>;

/** Missing and null are different. Nested objects and arrays are indivisible fields. */
export type SyncFieldValue =
  | { readonly present: false }
  | { readonly present: true; readonly value: SyncJsonValue };
export type SyncPatch = Readonly<Record<string, SyncFieldValue>>;

export type SyncConnectivity = 'online' | 'offline' | 'unknown';
export type SyncOperationStatus =
  | 'pending' | 'syncing' | 'awaiting_review' | 'synced' | 'not_selected' | 'blocked';

/** Durable acknowledgment from a validated server adapter, not a network-upload status. */
export type SyncServerReceipt =
  | { readonly kind: 'applied'; readonly receivedAt: string; readonly revision: string; readonly record: SyncRecord | null }
  | { readonly kind: 'awaiting_review'; readonly receivedAt: string; readonly conflictId: string };

export type SyncReviewFieldProvenance = {
  readonly userId: string | null;
  readonly actorName: string | null;
  readonly connectivity: SyncConnectivity;
  readonly savedAt?: string | null;
  readonly deviceId?: string | null;
  readonly serverRecordedAt?: string | null;
  readonly origin?: string | null;
  readonly revision?: string | null;
  readonly approvedBy?: string;
  readonly approvedByName?: string | null;
  readonly approvedAt?: string;
};
export type FleetSyncReviewCandidate = {
  readonly id: string;
  readonly operationId: string;
  readonly baseRevision: string;
  readonly currentRevision: string;
  readonly baseRecord: SyncRecord;
  readonly currentRecord: SyncRecord | null;
  readonly proposedRecord: SyncRecord;
  readonly reason: 'fields' | 'deleted' | 'recreated';
  /** Fresh review may detect deletion/re-creation since the candidate was stored. */
  readonly lifecycleChanged?: boolean;
  readonly fieldConflicts: readonly SyncFieldConflict[];
  readonly provenance: SyncProvenance & { readonly actorName: string | null };
  readonly receivedAt: string;
};
export type SyncReviewChoices = Readonly<Record<string, string>>;
export type FleetSyncReview = {
  readonly companyId: string;
  readonly entityType: 'vehicle' | 'issue';
  readonly entityId: string;
  readonly currentRevision: string;
  readonly currentRecord: SyncRecord | null;
  readonly currentProvenance: Readonly<Record<string, SyncReviewFieldProvenance>>;
  readonly candidates: readonly FleetSyncReviewCandidate[];
  readonly fields: Readonly<Record<string, {
    readonly current: SyncFieldValue;
    readonly options: readonly { readonly source: string; readonly value: SyncFieldValue; readonly provenance: SyncReviewFieldProvenance }[];
  }>>;
  readonly reviewToken: string;
};
export type FleetSyncReviewRequest = Pick<FleetSyncReview, 'companyId' | 'entityType' | 'entityId' | 'reviewToken'> & {
  readonly requestId: string;
  /** Every affected field, selecting 'current' or an offered candidate ID. */
  readonly choices: SyncReviewChoices;
};
export type SyncReviewOutcomeKind = 'kept' | 'partially_kept' | 'not_selected';
export type SyncReviewOutcome = {
  readonly kind: 'reviewed';
  readonly decisionId: string;
  readonly conflictId: string;
  readonly operationId: string;
  readonly decidedAt: string;
  readonly outcome: SyncReviewOutcomeKind;
  readonly keptFields: readonly string[];
  readonly discardedFields: readonly string[];
  readonly revision: string;
};
export type FleetSyncReviewDecision = {
  readonly kind: 'resolved';
  readonly decisionId: string;
  readonly decidedAt: string;
  readonly revision: string;
  readonly record: SyncRecord | null;
  readonly outcomes: readonly (Pick<SyncReviewOutcome, 'conflictId' | 'operationId' | 'outcome' | 'keptFields' | 'discardedFields'> & { readonly userId: string })[];
};

export type SyncProvenance = {
  readonly userId: string;
  readonly deviceId: string;
  /** Device-reported, not a trusted ordering or authorization source. */
  readonly savedAt: string;
  readonly connectivity: SyncConnectivity;
};

export type SyncMutation =
  | { readonly kind: 'create'; readonly record: SyncRecord }
  | { readonly kind: 'update'; readonly baseRevision: string; readonly base: SyncRecord; readonly patch: SyncPatch }
  | { readonly kind: 'delete'; readonly baseRevision: string; readonly base: SyncRecord }
  /** Typed business adapters must allowlist and validate each command server-side. */
  | { readonly kind: 'command'; readonly command: string; readonly payload: SyncRecord };

export type SyncOperation = {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly companyId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly provenance: SyncProvenance;
  readonly dependsOn: readonly string[];
  readonly mutation: SyncMutation;
};

export type SyncFieldConflict = {
  readonly field: string;
  readonly reason: 'overlap' | 'related_fields';
  readonly base: SyncFieldValue;
  readonly current: SyncFieldValue;
  readonly proposed: SyncFieldValue;
  /** Includes changed fields in an invariant group, for review context. */
  readonly relatedFields: readonly string[];
};

export type SyncMergeResult =
  | { readonly kind: 'merged'; readonly record: SyncRecord; readonly changedFields: readonly string[] }
  | { readonly kind: 'conflict'; readonly reason: 'fields'; readonly fields: readonly SyncFieldConflict[] }
  | { readonly kind: 'conflict'; readonly reason: 'deleted' };

export type SyncMergePolicy = {
  /** Conservatively treat these groups as units, e.g. assignment ID + status. */
  readonly fieldGroups?: readonly (readonly string[])[];
};

const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

// Validate at this pure boundary as persisted/network JSON is not made safe by TS types.
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) throw new Error('Sync values must be finite JSON data.');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error('Sync values must contain only plain JSON objects.');
  }
  if (ancestors.has(value)) throw new Error('Sync values must not contain cycles.');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!owns(value, String(index))) throw new Error('Sync arrays must not contain holes.');
      assertJson(value[index], ancestors);
    }
  } else {
    for (const child of Object.values(value)) assertJson(child, ancestors);
  }
  ancestors.delete(value);
}

function assertRecord(value: unknown): asserts value is SyncRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a sync record.');
  assertJson(value);
}

function assertPatch(patch: SyncPatch): void {
  assertRecord(patch);
  for (const slot of Object.values(patch)) {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)
      || !owns(slot, 'present') || typeof slot.present !== 'boolean'
      || (slot.present ? !owns(slot, 'value') : owns(slot, 'value'))
      || Object.keys(slot).length !== (slot.present ? 2 : 1)) {
      throw new Error('Expected an explicit present or absent sync field.');
    }
  }
}

function equalJson(left: SyncJsonValue, right: SyncJsonValue): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  const a = left as SyncRecord;
  const b = right as SyncRecord;
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((key) => owns(b, key) && equalJson(a[key], b[key]));
}

function field(record: SyncRecord, key: string): SyncFieldValue {
  return owns(record, key) ? { present: true, value: record[key] } : { present: false };
}

function equalField(left: SyncFieldValue, right: SyncFieldValue): boolean {
  return left.present ? right.present && equalJson(left.value, right.value) : !right.present;
}

/** UI defaults only; never approves anything. Leave overlaps/lifecycle changes for explicit selection. */
export function suggestSyncReviewChoices(review: FleetSyncReview): SyncReviewChoices {
  if (review.currentRecord === null) return {};
  assertRecord(review.currentRecord);
  const candidates = new Map(review.candidates.map((candidate) => [candidate.id, candidate]));
  if (candidates.size !== review.candidates.length) throw new Error('Duplicate review candidate.');
  const choices: [string, string][] = [];
  for (const key of Object.keys(review.fields).sort()) {
    const definition = review.fields[key];
    assertPatch(Object.fromEntries([[key, definition.current]]));
    if (!equalField(definition.current, field(review.currentRecord, key))) throw new Error('Review field does not match current data.');
    const options = definition.options.map((option) => {
      const candidate = candidates.get(option.source);
      if (!candidate || option.source === 'current') throw new Error('Unknown review candidate source.');
      assertRecord(candidate.baseRecord);
      assertRecord(candidate.proposedRecord);
      assertPatch(Object.fromEntries([[key, option.value]]));
      if (!equalField(option.value, field(candidate.proposedRecord, key)) || equalField(option.value, field(candidate.baseRecord, key))) {
        throw new Error('Review option does not match its candidate change.');
      }
      return { option, candidate };
    });
    if (!options.length || options.some(({ candidate }) => candidate.reason !== 'fields' || candidate.lifecycleChanged)) continue;
    if (options.every(({ option }) => equalField(option.value, definition.current))) {
      choices.push([key, 'current']);
    } else if (options.every(({ option, candidate }) => equalField(option.value, options[0].option.value)
      && equalField(field(candidate.baseRecord, key), definition.current))) {
      choices.push([key, options[0].option.source]);
    }
  }
  return Object.fromEntries(choices);
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Both arguments must be complete projections of the same editable field set. */
export function createSyncPatch(base: SyncRecord, proposed: SyncRecord): SyncPatch {
  assertRecord(base);
  assertRecord(proposed);
  const fields = [...new Set([...Object.keys(base), ...Object.keys(proposed)])].sort();
  return copy(Object.fromEntries(fields
    .filter((key) => !equalField(field(base, key), field(proposed, key)))
    .map((key) => [key, field(proposed, key)])));
}

/**
 * Three-way top-level field merge. No timestamps or revision ordering are used.
 * A conflict deliberately returns NO applicable record/partial patch: the server
 * must persist candidates and validate the whole business operation atomically.
 * Server adapters must validate editable fields, base revision/snapshot, current
 * permissions and domain invariants under a lock; this function is not that guard.
 * `current === null` means an authoritative deletion, never a failed/missing fetch.
 */
export function mergeSyncUpdate(
  base: SyncRecord,
  current: SyncRecord | null,
  patch: SyncPatch,
  policy: SyncMergePolicy = {},
): SyncMergeResult {
  assertRecord(base);
  assertPatch(patch);
  if (current === null) return { kind: 'conflict', reason: 'deleted' };
  assertRecord(current);

  const fields = Object.keys(patch).sort();
  const conflicts: SyncFieldConflict[] = [];
  const changes = new Map<string, SyncFieldValue>();
  const serverChanged = (key: string) => !equalField(field(base, key), field(current, key));

  for (const key of fields) {
    const original = field(base, key);
    const latest = field(current, key);
    const proposed = patch[key];
    // Redundant base values must never undo somebody else's subsequent edit.
    if (equalField(original, proposed) || equalField(latest, proposed)) continue;
    const relatedFields = [...new Set((policy.fieldGroups ?? [])
      .filter((group) => group.includes(key))
      .flatMap((group) => group.filter(serverChanged)))].sort();
    if (serverChanged(key) || relatedFields.length) {
      conflicts.push({
        field: key,
        reason: serverChanged(key) ? 'overlap' : 'related_fields',
        base: original, current: latest, proposed, relatedFields,
      });
    } else {
      changes.set(key, proposed);
    }
  }

  if (conflicts.length) return copy({ kind: 'conflict', reason: 'fields', fields: conflicts });
  // fromEntries and defineProperty keep literal JSON keys such as __proto__ safe.
  const record = copy(current) as Record<string, SyncJsonValue>;
  for (const [key, proposed] of changes) {
    if (proposed.present) {
      Object.defineProperty(record, key, { value: copy(proposed.value), enumerable: true, configurable: true, writable: true });
    } else {
      delete record[key];
    }
  }
  return { kind: 'merged', record, changedFields: [...changes.keys()] };
}
