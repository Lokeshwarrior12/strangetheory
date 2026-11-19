import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { initClientMonitoring } from './lib/monitoring';
import App from './App.tsx';
import './index.css';

initClientMonitoring();

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(<App />);
