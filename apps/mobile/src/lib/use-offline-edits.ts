import type { InventoryItem, Training } from '@fireops/domain';
import type { CompanyReceipt } from '@/lib/receipts-store';
import { useMemo } from 'react';
import { entriesAfterDownload } from '@/lib/offline-company-snapshot';
import { editBase, overlayQualifications, pendingEdits, scopedUserEntries, type EditBase, type PendingEdit } from '@/lib/offline-user-sync';
import { useOptionalOfflineSync } from '@/providers/offline-sync-provider';

type Member = { company: { id: string }; user: { id: string } } | null;

/**
 * A list with this device's unsynced guarded edits/deletes on top (deleted rows
 * hidden, changed fields shown), plus the base a new edit of a row must carry.
 * `watermark`: receipt watermark of the verified download being shown, if any.
 */
export function useOfflineEdits<Item extends { id: string }>(items: Item[], member: Member, entityType: string, commands: { update?: string; delete?: string },
  apply: (item: Item, changes: Record<string, unknown>) => Item, watermark?: string | null) {
  const offlineSync = useOptionalOfflineSync();
  const entries = useMemo(() => member ? scopedUserEntries(offlineSync?.state.entries ?? [], member.user.id, member.company.id) : [], [offlineSync?.state.entries, member]);
  const pending = useMemo(() => pendingEdits(entriesAfterDownload(entries, watermark), entityType, commands), [entries, watermark, entityType, commands]);
  const shown = useMemo(() => pending.size ? items.filter((item) => !pending.get(item.id)?.deleted).map((item) => { const edit = pending.get(item.id); return edit && Object.keys(edit.changes).length ? apply(item, edit.changes) : item; }) : items, [items, pending, apply]);
  return {
    items: shown,
    pending: pending as ReadonlyMap<string, PendingEdit>,
    /** Base for a new change to this row: the latest own unsynced change, else the version shown. */
    baseFor: (id: string, seen: Exclude<EditBase, { afterOperation: string }>) => editBase(entries, entityType, id, seen, watermark),
  };
}


const trainingCommands = { update: 'training.update', delete: 'training.delete' };
const applyTraining = (training: Training, changes: Record<string, unknown>): Training => ({ ...training,
  courseCode: (changes.courseCode as string) ?? training.courseCode, courseTitle: (changes.courseTitle as string) ?? training.courseTitle,
  date: (changes.startsAt as string) ?? training.date, location: (changes.location as string) ?? training.location, instructor: (changes.instructor as string) ?? training.instructor,
  capacity: (changes.capacity as number) ?? training.capacity, information: (changes.courseInformation as string) ?? training.information });
/** Trainings with this device's unsynced edits/deletes on top. */
export const useTrainingEdits = (trainings: Training[], member: Member, watermark?: string | null) => useOfflineEdits(trainings, member, 'training', trainingCommands, applyTraining, watermark);

const itemCommands = { update: 'item.update', delete: 'item.delete' };
const applyItem = (item: InventoryItem, changes: Record<string, unknown>): InventoryItem => ({ ...item, name: (changes.name as string) ?? item.name, quantity: (changes.quantity as number) ?? item.quantity });
/** Inventory items with this device's unsynced renames, stock edits and deletes on top. */
export const useInventoryEdits = (items: InventoryItem[], member: Member, watermark?: string | null) => useOfflineEdits(items, member, 'inventory_item', itemCommands, applyItem, watermark);

const receiptCommands = { update: 'receipt.update', delete: 'receipt.delete' };
const applyReceipt = (receipt: CompanyReceipt, changes: Record<string, unknown>): CompanyReceipt => ({ ...receipt, name: (changes.name as string) ?? receipt.name, amountCents: (changes.amountCents as number) ?? receipt.amountCents });
/** Receipts with this device's unsynced edits/deletes on top. */
export const useReceiptEdits = (receipts: CompanyReceipt[], member: Member, watermark?: string | null) => useOfflineEdits(receipts, member, 'receipt', receiptCommands, applyReceipt, watermark);

/** The caller's own crew record with this device's unsynced qualification changes on top (no files offline). */
export function useOwnQualifications<Crew extends { id: string; credentials?: unknown[]; experiences?: unknown[]; annualRecord?: unknown }>(member: Crew | undefined, account: Member) {
  const offlineSync = useOptionalOfflineSync();
  const entries = offlineSync?.state.entries;
  return useMemo(() => member && account ? overlayQualifications(member, scopedUserEntries(entries ?? [], account.user.id, account.company.id)) : member, [member, account, entries]);
}
