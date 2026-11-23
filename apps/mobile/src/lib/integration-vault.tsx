import {createContext, useContext, useMemo, type PropsWithChildren} from 'react';
import {IntegrationVault} from '@fireops/domain';

const IntegrationContext = createContext<IntegrationVault | null>(null);

/** Session vault. Secrets stay sealed in memory and are not written to disk. */
export function IntegrationVaultProvider({children}: PropsWithChildren) {
  const vault = useMemo(() => new IntegrationVault('alarmops-mobile-session'), []);
  return <IntegrationContext.Provider value={vault}>{children}</IntegrationContext.Provider>;
}

export function useIntegrationVault() {
  const vault = useContext(IntegrationContext);
  if (!vault) throw new Error('Integration vault is missing.');
  return vault;
}
