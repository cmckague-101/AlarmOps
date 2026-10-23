import type { CompanySnapshot, CompanySnapshotSection } from './offline-company-snapshot';

// Bridge from the provider-owned verified company-list downloads to the
// module-level stores. Stores use a section only for the same company and only
// while offline; it is display data, never an edit base.
type Published = { companyId: string; userId: string; sections: Partial<Record<CompanySnapshotSection, { snapshot: CompanySnapshot; verifiedAt: string }>> };
let current: Published | null = null;
const listeners = new Set<() => void>();

export function publishOfflineCompanyLists(value: Published | null) {
  if (value === current) return;
  current = value;
  listeners.forEach((listener) => listener());
}

export type DownloadedListInfo = { verifiedAt: string; serverRequestAt: string; receiptWatermark: string };
/** Downloaded section for this company, if any: its rows per table and when it was verified. */
export function downloadedCompanyList(section: CompanySnapshotSection, companyId: string | null | undefined): { tables: Record<string, Record<string, unknown>[]>; info: DownloadedListInfo } | null {
  const saved = current && companyId && current.companyId === companyId ? current.sections[section] : undefined;
  return saved ? { tables: saved.snapshot.tables, info: { verifiedAt: saved.verifiedAt, serverRequestAt: saved.snapshot.serverRequestAt, receiptWatermark: saved.snapshot.receiptWatermark } } : null;
}

export function subscribeOfflineCompanyLists(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
