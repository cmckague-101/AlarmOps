import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminPortal from './AdminPortal';
import AccountSetup from './AccountSetup';
import './styles.css';

const Root = window.location.pathname.startsWith('/system-admin')
  ? AdminPortal
  : window.location.pathname.startsWith('/accept-invite') ? AccountSetup : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Root /></React.StrictMode>
);
