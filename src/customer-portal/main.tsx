import React from 'react';
import ReactDOM from 'react-dom/client';
import CustomerPortalApp from './App';
import '../dashboard/index.css'; // Use the same styles as dashboard

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CustomerPortalApp />
  </React.StrictMode>
);
