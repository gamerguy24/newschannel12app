import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';
import 'leaflet/dist/leaflet.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing from index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

/**
 * Register the service worker on every visit, not only when somebody turns
 * notifications on.
 *
 * A browser will not offer to install a site that has no active worker, so
 * leaving this until the push opt-in meant the install option never appeared
 * for anyone. Registering after load keeps it off the critical path.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // An unregistered worker costs notifications and offline start, not
      // the site itself, so a failure here is not worth surfacing.
    });
  });
}
