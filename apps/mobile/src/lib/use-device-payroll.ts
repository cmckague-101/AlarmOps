import { useMemo } from 'react';
import type { PayrollForm } from '@fireops/domain';
import { devicePayrollForms, overlayPayrollForms, scopedUserEntries } from '@/lib/offline-user-sync';
import { useOptionalOfflineSync } from '@/providers/offline-sync-provider';

type Member = { company: { id: string }; user: { id: string; name: string } } | null;

/** Payroll forms with this device's unsynced saves on top, and the account-bound offline command writer. */
export function useDevicePayroll(forms: PayrollForm[], member: Member) {
  const offlineSync = useOptionalOfflineSync();
  const entries = offlineSync?.state.entries;
  const device = useMemo(() => member ? devicePayrollForms(scopedUserEntries(entries ?? [], member.user.id, member.company.id)) : new Map<string, never>(), [entries, member]);
  const shown = useMemo(() => member && device.size ? overlayPayrollForms(forms, device, { companyId: member.company.id, userId: member.user.id, name: member.user.name }) : forms, [forms, device, member]);
  const userSync = offlineSync?.userSync && member && offlineSync.userSync.scope.companyId === member.company.id && offlineSync.userSync.scope.userId === member.user.id ? offlineSync.userSync : null;
  return { forms: shown, device, userSync, offline: !!offlineSync?.offline };
}
