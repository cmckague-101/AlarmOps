/** Store-method ZIP helpers for receipt original-file export, shared by web and mobile. */
import {receiptDate} from './receipts';

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function safeReceiptExportName(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'receipt';
}

export function receiptFileExtension(fileName: string, mimeType?: string) {
  const fromName = fileName.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  if (mimeType?.startsWith('image/')) return 'jpg';
  return 'bin';
}

export type ReceiptExportSource = {
  id: string;
  name: string;
  fileName: string;
  mimeType?: string;
};

export function receiptExportEntryName(receipt: ReceiptExportSource, purchaseDate: string) {
  const ext = receiptFileExtension(receipt.fileName, receipt.mimeType);
  const id = receipt.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'receipt';
  return `${purchaseDate || 'undated'}-${safeReceiptExportName(receipt.name)}-${id}.${ext}`;
}

export function receiptExportZipName(today = new Date()) {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `receipts-${y}-${m}-${d}.zip`;
}

export type ReceiptExportEntry = {name: string; data: Uint8Array};

/** Returns `name`, or `name` with a numeric suffix before the extension, so it is unique within `used` (which it updates). */
export function uniqueReceiptExportName(name: string, used: Set<string>) {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; used.has(candidate); n++) candidate = `${base}-${n}${ext}`;
  used.add(candidate);
  return candidate;
}

export function receiptSingleExportZipName(receipt: ReceiptExportSource, purchaseDate: string) {
  const id = receipt.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'receipt';
  return `${purchaseDate || 'undated'}-${safeReceiptExportName(receipt.name)}-${id}.zip`;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  bytes[0] = value & 0xff;
  bytes[1] = (value >>> 8) & 0xff;
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  bytes[0] = value & 0xff;
  bytes[1] = (value >>> 8) & 0xff;
  bytes[2] = (value >>> 16) & 0xff;
  bytes[3] = (value >>> 24) & 0xff;
  return bytes;
}

function concat(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Build an uncompressed ZIP from named file entries. */
export function zipStore(files: ReceiptExportEntry[]) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name.replace(/^\/+/, ''));
    const checksum = crc32(file.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(file.data.length),
      u32(file.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      file.data,
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(file.data.length),
      u32(file.data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDirectory = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, centralDirectory, end]);
}

type ExportableReceipt = ReceiptExportSource & {storagePath?: string | null; purchasedOn?: string | null; createdAt: string};

/**
 * Downloads each receipt's original file and names it for the ZIP. Receipts without a
 * remote file are skipped (device-only uploads), and per-file download failures are
 * collected instead of aborting the whole export.
 */
export async function collectReceiptExportEntries<T extends ExportableReceipt>(
  receipts: T[],
  fetchBytes: (receipt: T) => Promise<Uint8Array>,
) {
  const remote = receipts.filter((receipt) => Boolean(receipt.storagePath));
  const entries: ReceiptExportEntry[] = [];
  const failures: string[] = [];
  const used = new Set<string>();
  for (const receipt of remote) {
    try {
      const data = await fetchBytes(receipt);
      entries.push({name: uniqueReceiptExportName(receiptExportEntryName(receipt, receiptDate(receipt)), used), data});
    } catch {
      failures.push(receipt.name);
    }
  }
  const warnings: string[] = [];
  if (failures.length) warnings.push(`Skipped files that could not download: ${failures.join(', ')}.`);
  if (remote.length < receipts.length) warnings.push('Receipts still uploading from a device were skipped.');
  return {entries, skipped: receipts.length - entries.length, warning: warnings.length ? warnings.join(' ') : undefined};
}
