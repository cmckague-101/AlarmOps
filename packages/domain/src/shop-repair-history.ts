import type { FleetRepair } from './fleet-repairs';
import { formatRepairReading } from './fleet-repairs';
import type { ShopJob, ShopJobNote } from './shop';
import { shopPriorityLabel } from './shop';

export type RepairHistoryEntry = {
  id: string;
  kind: 'job' | 'repair';
  title: string;
  /** Closing time for jobs, filing time for repairs. */
  date: string;
  meta: string;
  notes: string;
  jobId?: string;
};

/** Closed shop jobs and filed fleet repairs for one scope, newest first. */
export function repairHistoryEntries(jobs: readonly ShopJob[], repairs: readonly FleetRepair[], notes: readonly ShopJobNote[]): RepairHistoryEntry[] {
  const noteText = (jobId: string) => notes
    .filter((note) => note.jobId === jobId && note.kind === 'note')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((note) => note.body.trim())
    .filter(Boolean)
    .join('\n');
  const closed: RepairHistoryEntry[] = jobs.filter((job) => job.status === 'done').map((job) => ({
    id: `job:${job.id}`,
    kind: 'job',
    title: job.title,
    date: job.updatedAt,
    meta: [`${job.jobNumber} · ${shopPriorityLabel(job.priority)}`, job.assignedTechName, job.kind === 'general' ? job.shopArea : undefined].filter(Boolean).join(' · '),
    notes: noteText(job.id),
    jobId: job.id,
  }));
  const filed: RepairHistoryEntry[] = repairs.map((repair) => ({
    id: `repair:${repair.id}`,
    kind: 'repair',
    title: repair.repairTypeText,
    date: repair.createdAt,
    meta: [
      `${formatRepairReading(repair.readingValue, repair.readingUnit)} (${repair.readingSource === 'motive' ? 'Motive' : `manual: ${repair.manualReason ?? ''}`})`,
      repair.techName,
      repair.laborHours !== undefined ? `${repair.laborHours} labor hrs` : undefined,
    ].filter(Boolean).join(' · '),
    notes: repair.notes,
  }));
  return [...closed, ...filed].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);

function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Printable repair history; web prints it in a window, mobile renders it with expo-print. */
export function repairHistoryHtml(subject: { title: string; subtitle: string }, entries: readonly RepairHistoryEntry[], generatedAt = new Date()): string {
  const rows = entries.length
    ? entries.map((entry) => `<article class="entry">
        <header><h2>${escapeHtml(entry.title)}</h2><span class="closed">${entry.kind === 'job' ? 'Closed' : 'Filed'} ${escapeHtml(formatDate(entry.date))}</span></header>
        <p class="meta">${escapeHtml(entry.meta)}</p>
        ${entry.notes.trim() ? `<p class="notes">${escapeHtml(entry.notes.trim()).replace(/\n/g, '<br/>')}</p>` : ''}
      </article>`).join('')
    : '<p class="empty">No repair history on file.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Repair history — ${escapeHtml(subject.title)}</title><style>
    @page{margin:0.6in}
    *{box-sizing:border-box}
    body{margin:0;padding:40px 48px;color:#1f1f1f;font:13px/1.45 Helvetica,Arial,sans-serif;background:#fff}
    .sheet{max-width:760px;margin:0 auto}
    header.doc{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:16px;margin-bottom:22px}
    header.doc h1{margin:0;font-size:28px;letter-spacing:.02em}
    header.doc .subject{margin:6px 0 0;font-size:15px;font-weight:700;color:#111}
    header.doc .subtitle{margin:4px 0 0;color:#666;font-size:12px}
    header.doc .generated{color:#666;font-size:12px;text-align:right;white-space:nowrap}
    .entry{padding:14px 0;border-bottom:1px solid #e6e6e6;break-inside:avoid}
    .entry header{display:flex;justify-content:space-between;gap:16px;align-items:baseline}
    .entry h2{margin:0;font-size:15px;font-weight:700;color:#111}
    .closed{color:#555;font-size:12px;white-space:nowrap}
    .meta{margin:6px 0 0;color:#555;font-size:12px}
    .notes{margin:8px 0 0;color:#222}
    .empty{color:#666;margin:24px 0}
    @media print{body{padding:16px}}
  </style></head><body><div class="sheet">
    <header class="doc">
      <div><h1>Repair history</h1><p class="subject">${escapeHtml(subject.title)}</p><p class="subtitle">${escapeHtml(subject.subtitle)}</p></div>
      <div class="generated">Prepared ${escapeHtml(generatedAt.toLocaleString('en-US'))}<br/>${entries.length} ${entries.length === 1 ? 'record' : 'records'}</div>
    </header>
    ${rows}
  </div></body></html>`;
}
