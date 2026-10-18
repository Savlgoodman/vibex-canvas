import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

function installSidecarBridge() {
  if (window.parent === window) return;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  window.addEventListener('message', (event: MessageEvent<{ type?: string; id?: string; result?: unknown; error?: string }>) => {
    if (event.source !== window.parent || event.data?.type !== 'vibex-sidecar-result' || !event.data.id) return;
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  });
  (window as Window & { __vibex_bridge?: unknown }).__vibex_bridge = {
    invoke(method: string, input?: unknown) {
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.parent.postMessage({ type: 'vibex-sidecar-invoke', id, method, input: input ?? null }, '*');
      });
    },
  };
}

installSidecarBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
