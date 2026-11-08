/** Browser-only helpers for receipt ZIP export; ZIP packaging lives in @fireops/domain. */

export function triggerBrowserDownload(data: Uint8Array, fileName: string, mimeType = 'application/zip') {
  const blob = new Blob([new Uint8Array(data)], {type: mimeType});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download in Safari/Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function fetchReceiptBytes(signedUrl: string) {
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error(`Receipt file could not download (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
