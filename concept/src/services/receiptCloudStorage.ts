export type ReceiptUpload = {fileUrl: string; fileId: string};

export async function uploadReceiptPhoto(uri: string): Promise<ReceiptUpload> {
  const endpoint = process.env.EXPO_PUBLIC_RECEIPT_UPLOAD_URL;
  if (!endpoint) throw new Error('Receipt cloud upload is not configured.');
  const body = new FormData();
  body.append('file', {uri, name: `receipt-${Date.now()}.jpg`, type: 'image/jpeg'} as unknown as Blob);
  body.append('recordType', 'receipt');
  const response = await fetch(endpoint, {method: 'POST', body});
  if (!response.ok) throw new Error(`Receipt upload failed with status ${response.status}.`);
  const result = await response.json() as Partial<ReceiptUpload>;
  if (!result.fileUrl || !result.fileId) throw new Error('Receipt upload response is missing fileUrl or fileId.');
  return {fileUrl: result.fileUrl, fileId: result.fileId};
}
