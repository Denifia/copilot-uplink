import { render, h } from 'preact';
import { App } from './app.js';
import 'material-symbols/outlined.css';

// ─── Service Worker ───────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('SW registration failed:', err);
  });
}

// ─── Mobile keyboard handling ─────────────────────────────────────────
// Chrome/Edge: VirtualKeyboard API gives env(keyboard-inset-height) in CSS.
// Safari/iOS:  dvh doesn't track the keyboard, so we sync #app to the
//              visual viewport — height for the keyboard, translateY for
//              the scroll offset iOS applies when focusing an input.
const appEl = document.getElementById('app')!;

if ('virtualKeyboard' in navigator) {
  (navigator as any).virtualKeyboard.overlaysContent = true;
} else if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => {
    appEl.style.height = `${vv.height}px`;
    appEl.style.transform = `translateY(${vv.offsetTop}px)`;
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
}

// ─── Render ───────────────────────────────────────────────────────────

render(h(App, {}), appEl);
