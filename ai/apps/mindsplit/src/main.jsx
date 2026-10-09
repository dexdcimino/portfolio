import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import MindSplit from './App.jsx';

/* Installing. Chrome fires beforeinstallprompt once, early, and only to a
   page that catches it; it is kept here for the install sheet (App.jsx,
   ?install=1 from the AI Lab card's download button) to use later. */
window.__msInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__msInstall = e; window.dispatchEvent(new Event('ms:installable')); });
window.addEventListener('appinstalled', () => { window.__msInstall = null; });

/* The service worker, for the installed app's offline launch. Not inside the
   homepage's preview frame (?embed=1), and not on the Vite dev server. */
const embedded = new URLSearchParams(location.search).get('embed') === '1';
if ('serviceWorker' in navigator && !embedded && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((err) => console.warn('mindsplit: no service worker', err));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MindSplit />
  </StrictMode>
);
