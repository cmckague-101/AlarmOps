import { ArrowLeft, Download, FileText } from 'lucide-react';
import type { CrewCredential, CrewMember } from '@fireops/domain';
import './MasterRecordPage.css';

type Section = { title: string; columns: string[]; rows: string[][] };

const formatDate = (value?: string) => value
  ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

const credentialsFor = (credentials: CrewCredential[], types: CrewCredential['recordType'][]) =>
  credentials.filter(item => item.recordType && types.includes(item.recordType));

function credentialRows(items: CrewCredential[]): string[][] {
  return items.map(item => [item.courseCode || '—', item.name, formatDate(item.completionDate), formatDate(item.expirationDate), item.provider || '—']);
}

function sectionsFor(member: CrewMember): Section[] {
  const credentials = member.credentials ?? [];
  const experiences = member.experiences ?? [];
  const annual = member.annualRecord;
  const trainingRows = credentialRows(credentialsFor(credentials, ['Training']));
  if (annual) {
    trainingRows.push(
      ['RT-130', 'Annual Fireline Safety Refresher', formatDate(annual.rt130CompletionDate), formatDate(annual.rt130CurrencyDate), '—'],
      ['WCT', 'Work Capacity Test', formatDate(annual.wctCompletionDate), formatDate(annual.wctCurrencyDate), '—'],
    );
  }
  return [
    { title: 'Incident Qualifications', columns: ['Code', 'Position title', 'Completed', 'Expires', 'Provider'], rows: credentialRows(credentialsFor(credentials, ['Qualification'])) },
    { title: 'Position Task Books', columns: ['Code', 'Position title', 'Initiated / completed', 'Expires', 'Provider'], rows: credentialRows(credentialsFor(credentials, ['Task Book'])) },
    { title: 'Training', columns: ['Code', 'Training title', 'Completed', 'Currency / expiration', 'Provider'], rows: trainingRows },
    { title: 'Licenses and Certificates', columns: ['Code', 'License or certificate title', 'Issued', 'Expiration', 'Issued by'], rows: credentialRows(credentialsFor(credentials, ['License', 'DOT Medical'])) },
    { title: 'Incident Experience', columns: ['Incident', 'Position', 'Days', 'Documentation'], rows: experiences.map(item => [item.incident, item.position, item.days, item.file ? 'Attached' : '—']) },
    { title: 'Other Qualifications', columns: ['Code', 'Qualification title', 'Completed', 'Expiration', 'Provider'], rows: credentials.filter(item => !item.recordType).map(item => ['—', item.name, '—', '—', '—']) },
  ];
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!);

function packetHtml(member: CrewMember, sections: Section[]) {
  const generated = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const body = sections.map(section => `
    <section><h2>${escapeHtml(section.title)}</h2>
      <table><thead><tr>${section.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
      <tbody>${section.rows.length ? section.rows.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('') : `<tr><td class="empty" colspan="${section.columns.length}">No records on file</td></tr>`}</tbody></table>
    </section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(member.name)} — Master Record</title><style>
    @page{size:letter;margin:.45in}*{box-sizing:border-box}body{font:9px Arial,sans-serif;color:#111;margin:0}header{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}.responder small,.report small{display:block;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:4px}.responder strong{font-size:20px}.report{text-align:right;line-height:1.45}.report strong{font-size:11px}h1{font-size:15px;margin:0 0 3px}h2{font-size:10px;text-transform:uppercase;letter-spacing:.08em;background:#e9ece8;border:1px solid #333;margin:12px 0 0;padding:5px 6px;break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #777;text-align:left;vertical-align:top;padding:4px;overflow-wrap:anywhere}th{background:#f5f5f2;font-size:8px;text-transform:uppercase}.empty{text-align:center;color:#666;font-style:italic;padding:7px}footer{border-top:1px solid #777;margin-top:14px;padding-top:7px;display:flex;justify-content:space-between;color:#555}
  </style></head><body><header><div class="responder"><small>Responder</small><strong>${escapeHtml(member.name)}</strong></div><div class="report"><strong>Master Qualification Record</strong><br>Responder Master Record (C028) Report</div></header><main><h1>Master Record</h1>${body}</main><footer><span>FireOps qualification record</span><span>Prepared ${escapeHtml(generated)}</span></footer></body></html>`;
}

export default function MasterRecordPage({ member, onBack }: { member?: CrewMember; onBack: () => void }) {
  const sections = member ? sectionsFor(member) : [];
  const preparePacket = () => {
    if (!member) return;
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed'; frame.style.width = '1px'; frame.style.height = '1px'; frame.style.opacity = '0'; frame.style.pointerEvents = 'none';
    document.body.appendChild(frame);
    const documentToPrint = frame.contentDocument;
    if (!documentToPrint) { frame.remove(); return; }
    documentToPrint.open(); documentToPrint.write(packetHtml(member, sections)); documentToPrint.close();
    window.setTimeout(() => {
      const printWindow = frame.contentWindow;
      if (!printWindow) { frame.remove(); return; }
      const cleanup = () => frame.remove();
      printWindow.addEventListener('afterprint', cleanup, { once: true });
      printWindow.focus(); printWindow.print();
      window.setTimeout(cleanup, 60_000);
    }, 250);
  };

  return <div className="page master-record-page">
    <button className="qualification-back" onClick={onBack}><ArrowLeft /> Back to qualifications</button>
    <div className="master-record-heading"><div><p className="master-record-eyebrow">Master Record</p><h1>{member?.name ?? 'Master Record'}</h1></div></div>
    {!member ? <div className="master-record-empty"><FileText/><h2>No responder record found</h2><p>Your crew profile is not available.</p></div> : <>
      <section className="master-record-summary"><div><span>Responder</span><strong>{member.name}</strong></div><div><span>Credentials on record</span><strong>{member.credentials?.length ?? 0}</strong></div><div><span>Incident experience</span><strong>{member.experiences?.length ?? 0}</strong></div></section>
      <div className="master-record-sections">{sections.map(section => <section className="master-record-section" key={section.title}><div className="master-record-section-title"><h2>{section.title}</h2><span>{section.rows.length} {section.rows.length === 1 ? 'record' : 'records'}</span></div>{section.rows.length ? <div className="master-record-table-wrap"><table><thead><tr>{section.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{section.rows.map((row, rowIndex) => <tr key={`${section.title}-${rowIndex}`}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>)}</tbody></table></div> : <p className="master-record-no-records">No records on file</p>}</section>)}</div>
      <div className="master-record-actions"><button className="master-record-prepare" onClick={preparePacket}><Download /> Prepare PDF Packet</button></div>
    </>}
  </div>;
}
