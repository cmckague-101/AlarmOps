export type InvoiceWorkspaceRecord = {
  id: string;
  number: string;
  customer: string;
  incident: string;
  amount: number;
  invoiceDate: string;
  dueDate?: string;
  status: 'Draft'|'Ready'|'Sent'|'Paid';
  fiscalYear: number;
  source: 'FireOps'|'QuickBooks';
  sourceFileUrl?: string;
  quickBooksId?: string;
  aiConfidence?: number;
  poNumber?: string;
  netTerms?: string;
  billFrom?: string;
  billTo?: string;
  lineItems?: InvoiceLineItem[];
};

export type InvoiceLineItem = {id: string; description: string; quantity: number; rate: number};

export type InvoiceAnalysis = Omit<InvoiceWorkspaceRecord, 'id'|'status'|'fiscalYear'|'source'> & {confidence: number};

async function parseJson<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) throw new Error(`${operation} failed with status ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function analyzeInvoiceDocument(uri: string, mimeType: string, name: string): Promise<InvoiceAnalysis> {
  const endpoint = process.env.EXPO_PUBLIC_INVOICE_ANALYSIS_URL;
  if (!endpoint) throw new Error('Invoice AI analysis is not configured.');
  const body = new FormData();
  body.append('file', {uri, type: mimeType, name} as unknown as Blob);
  const result = await parseJson<Partial<InvoiceAnalysis>>(await fetch(endpoint, {method: 'POST', body}), 'Invoice analysis');
  if (!result.number || !result.customer || typeof result.amount !== 'number' || !result.invoiceDate) throw new Error('Invoice analysis returned incomplete invoice fields.');
  return {number:result.number,customer:result.customer,incident:result.incident||'',amount:result.amount,invoiceDate:result.invoiceDate,dueDate:result.dueDate,sourceFileUrl:result.sourceFileUrl,quickBooksId:result.quickBooksId,confidence:result.confidence||0};
}

export async function fetchQuickBooksInvoices(fiscalYear: number): Promise<InvoiceWorkspaceRecord[]> {
  const endpoint = process.env.EXPO_PUBLIC_QUICKBOOKS_API_URL;
  if (!endpoint) throw new Error('QuickBooks synchronization is not configured.');
  const separator = endpoint.includes('?') ? '&' : '?';
  const result = await parseJson<{invoices: InvoiceWorkspaceRecord[]}>(await fetch(`${endpoint}/invoices${separator}fiscalYear=${fiscalYear}`), 'QuickBooks invoice sync');
  return result.invoices.map(invoice => ({...invoice, fiscalYear, source:'QuickBooks'}));
}

export async function exportInvoiceToQuickBooks(invoice: InvoiceWorkspaceRecord): Promise<string> {
  const endpoint = process.env.EXPO_PUBLIC_QUICKBOOKS_API_URL;
  if (!endpoint) throw new Error('QuickBooks synchronization is not configured.');
  const result = await parseJson<{quickBooksId: string}>(await fetch(`${endpoint}/invoices`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invoice)}), 'QuickBooks invoice export');
  if (!result.quickBooksId) throw new Error('QuickBooks did not return an invoice ID.');
  return result.quickBooksId;
}
