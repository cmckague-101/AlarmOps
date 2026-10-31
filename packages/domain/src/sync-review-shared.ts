// Shared by the review and device-history clients; kept separate so neither imports the other.
export type SyncReviewTarget = { readonly entityType: 'vehicle' | 'issue'; readonly entityId: string };

export function syncReviewFileText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const file = value as Record<string, unknown>;
  if (typeof file.name !== 'string' || typeof file.type !== 'string' || typeof file.path !== 'string' || typeof file.dataUrl !== 'string') return null;
  return `File: ${file.name} (${file.type})\nStored at: ${file.path}${file.path.includes('/sync-') ? '\nUploaded from a device and verified by the server' : ''}`;
}
