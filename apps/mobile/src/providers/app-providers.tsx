import {useState,type PropsWithChildren} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {FireOpsThemeProvider} from '@/theme';
import {SessionProvider} from './session-provider';
import {NetworkProvider} from './network-provider';

export function AppProviders({children}:PropsWithChildren){
  const [queryClient]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:30_000,retry:2}}}));
  return <NetworkProvider><FireOpsThemeProvider><QueryClientProvider client={queryClient}><SessionProvider>{children}</SessionProvider></QueryClientProvider></FireOpsThemeProvider></NetworkProvider>;
}
