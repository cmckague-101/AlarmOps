import {describe, expect, it} from 'vitest';
import {
  collectReceiptExportEntries,
  crc32,
  receiptExportEntryName,
  receiptExportZipName,
  receiptFileExtension,
  receiptSingleExportZipName,
  safeReceiptExportName,
  uniqueReceiptExportName,
  zipStore,
} from './receipt-export';

describe('receipt export helpers', () => {
  it('sanitizes names and picks extensions', () => {
    expect(safeReceiptExportName(' Fuel @ Station 12! ')).toBe('Fuel-Station-12');
    expect(receiptFileExtension('photo.HEIC', 'image/jpeg')).toBe('heic');
    expect(receiptFileExtension('scan', 'application/pdf')).toBe('pdf');
    expect(receiptFileExtension('scan', 'image/png')).toBe('png');
  });

  it('builds unique entry and zip names', () => {
    const receipt = {
      id: '11111111-2222-4333-8444-555555555555',
      name: 'Fuel stop',
      fileName: 'fuel.jpg',
      mimeType: 'image/jpeg',
      createdAt: '2026-03-01T12:00:00Z',
    };
    expect(receiptExportEntryName(receipt, '2026-03-01')).toBe('2026-03-01-Fuel-stop-11111111.jpg');
    expect(receiptSingleExportZipName(receipt, '2026-03-01')).toBe('2026-03-01-Fuel-stop-11111111.zip');
    expect(receiptExportZipName(new Date('2026-11-02T12:00:00Z'))).toBe('receipts-2026-11-02.zip');
  });

  it('packs an empty and single-file zip with a valid end record', () => {
    expect(zipStore([])[0]).toBe(0x50);
    const payload = new TextEncoder().encode('receipt-bytes');
    const zip = zipStore([{name: '2026-01-01-fuel-abc12345.jpg', data: payload}]);
    expect(zip.length).toBeGreaterThan(payload.length);
    expect(crc32(payload)).toBeGreaterThan(0);
    // End of central directory signature
    expect([...zip.slice(zip.length - 22, zip.length - 18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});

describe('receipt export entry collection', () => {
  it('suffixes duplicate entry names before the extension', () => {
    const used = new Set<string>();
    expect(uniqueReceiptExportName('a.jpg', used)).toBe('a.jpg');
    expect(uniqueReceiptExportName('a.jpg', used)).toBe('a-2.jpg');
    expect(uniqueReceiptExportName('a.jpg', used)).toBe('a-3.jpg');
    expect(uniqueReceiptExportName('noext', used)).toBe('noext');
    expect(uniqueReceiptExportName('noext', used)).toBe('noext-2');
  });

  it('skips device-only receipts and download failures with a warning', async () => {
    const base = {fileName: 'r.pdf', mimeType: 'application/pdf', createdAt: '2026-03-01T12:00:00Z', purchasedOn: '2026-03-01'};
    const receipts = [
      {...base, id: 'aaaaaaaa-1', name: 'Fuel', storagePath: 'c/a.pdf'},
      {...base, id: 'aaaaaaaa-2', name: 'Fuel', storagePath: 'c/b.pdf'},
      {...base, id: 'bbbbbbbb-1', name: 'Broken', storagePath: 'c/x.pdf'},
      {...base, id: 'cccccccc-1', name: 'Local', storagePath: ''},
    ];
    const result = await collectReceiptExportEntries(receipts, async (receipt) => {
      if (receipt.name === 'Broken') throw new Error('403');
      return new TextEncoder().encode(receipt.id);
    });
    expect(result.entries.map((entry) => entry.name)).toEqual(['2026-03-01-Fuel-aaaaaaaa.pdf', '2026-03-01-Fuel-aaaaaaaa-2.pdf']);
    expect(result.skipped).toBe(2);
    expect(result.warning).toContain('Broken');
    expect(result.warning).toContain('still uploading');
  });

  it('writes local headers at the offsets recorded in the central directory', () => {
    const files = [
      {name: 'one.txt', data: new TextEncoder().encode('first')},
      {name: 'two.txt', data: new TextEncoder().encode('second file')},
    ];
    const zip = zipStore(files);
    const view = new DataView(zip.buffer);
    const eocd = zip.length - 22;
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    let cursor = view.getUint32(eocd + 16, true);
    for (const file of files) {
      expect(view.getUint32(cursor, true)).toBe(0x02014b50);
      expect(view.getUint32(cursor + 16, true)).toBe(crc32(file.data));
      const local = view.getUint32(cursor + 42, true);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      const nameLength = view.getUint16(cursor + 28, true);
      cursor += 46 + nameLength;
    }
  });
});
