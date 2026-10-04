import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// One-time cleanup: the v1 audio cache served stale clips (es-b1-1 #1–20
// were the prototype deck's recordings). Audio now lives in a v2 cache with
// versioned URLs; drop the old one so the phone can never play it again.
if ('caches' in window) void caches.delete('satzhoeren-audio').catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
