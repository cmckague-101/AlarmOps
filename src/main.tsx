import { StrictMode, Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const FleetApp = lazy(() => import('./FleetApp'));
const AdminPortal = lazy(() => import('./AdminPortal'));
const AccountSetup = lazy(() => import('./AccountSetup'));

const Root = window.location.pathname.startsWith('/system-admin')
  ? AdminPortal
  : window.location.pathname.startsWith('/accept-invite') ? AccountSetup : FleetApp;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="route-loading" role="status">Loading FireOps...</div>}>
      <Root />
    </Suspense>
  </StrictMode>
);
