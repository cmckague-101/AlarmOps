export type InvoiceStatus = 'draft' | 'submitted';

export type InvoiceCustomer = {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceAttachment = {
  name: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
};

export type InvoiceForm = {
  id: string;
  companyId: string;
  createdBy: string;
  createdByName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: number;
  customerId: string;
  attachment: InvoiceAttachment | null;
  status: InvoiceStatus;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
