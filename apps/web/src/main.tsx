import { StrictMode, Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const FleetApp = lazy(() => import('./FleetApp'));
const AccountSetup = lazy(() => import('./AccountSetup'));
const PasswordReset = lazy(() => import('./PasswordReset'));
const PrivacyPolicy = lazy(() => import('./PrivacyPolicy'));

const path=window.location.pathname;
const Root = path.startsWith('/accept-invite')
  ? AccountSetup
  : path.startsWith('/reset-password')
    ? PasswordReset
    : path==='/privacy'||path.startsWith('/privacy/')
      ? PrivacyPolicy
      : FleetApp;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="route-loading" role="status">Loading FireOps...</div>}>
      <Root />
    </Suspense>
  </StrictMode>
);
