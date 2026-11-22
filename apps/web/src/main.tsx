import { StrictMode, Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './base.css';

const FleetRoot = lazy(() => import('./FleetRoot'));
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
      : FleetRoot;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="route-loading" role="status">Loading AlarmOps...</div>}>
      <Root />
    </Suspense>
  </StrictMode>
);
