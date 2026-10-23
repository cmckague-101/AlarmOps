import { useMemo } from 'react';
import type { InvoiceForm, PayrollForm } from '@fireops/domain';
import { deviceInvoiceForms, devicePayrollForms, overlayInvoiceForms, overlayPayrollForms, scopedUserEntries } from '@/lib/offline-user-sync';
import { entriesAfterDownload } from '@/lib/offline-company-snapshot';
import { useOptionalOfflineSync } from '@/providers/offline-sync-provider';

type Member = { company: { id: string }; user: { id: string; name: string } } | null;

/** `watermark`: the receipt watermark of a verified download being shown, so changes synced after it still overlay. */
function useDeviceForms<Form, Saved>(forms: Form[], member: Member, read: typeof devicePayrollForms | typeof deviceInvoiceForms, overlay: (forms: Form[], device: Map<string, Saved>, author: { companyId: string; userId: string; name: string }) => Form[], watermark?: string | null) {
  const offlineSync = useOptionalOfflineSync();
  const entries = offlineSync?.state.entries;
  const device = useMemo(() => (member ? read(entriesAfterDownload(scopedUserEntries(entries ?? [], member.user.id, member.company.id), watermark)) : new Map()) as Map<string, Saved>, [entries, member, read, watermark]);
  const shown = useMemo(() => member && device.size ? overlay(forms, device, { companyId: member.company.id, userId: member.user.id, name: member.user.name }) : forms, [forms, device, member, overlay]);
  const userSync = offlineSync?.userSync && member && offlineSync.userSync.scope.companyId === member.company.id && offlineSync.userSync.scope.userId === member.user.id ? offlineSync.userSync : null;
  return { forms: shown, device, userSync, offline: !!offlineSync?.offline };
}
/** Payroll forms with this device's unsynced saves on top, and the account-bound offline command writer. */
export const useDevicePayroll = (forms: PayrollForm[], member: Member, watermark?: string | null) => useDeviceForms(forms, member, devicePayrollForms, overlayPayrollForms, watermark);
/** Invoices with this device's unsynced saves on top, and the account-bound offline command writer. */
export const useDeviceInvoices = (forms: InvoiceForm[], member: Member, watermark?: string | null) => useDeviceForms(forms, member, deviceInvoiceForms, overlayInvoiceForms, watermark);
