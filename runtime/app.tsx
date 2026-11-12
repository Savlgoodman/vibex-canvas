import { createElement } from 'react';
import { defineVibeXPlugin } from '@vibex/plugin-sdk';
import type { JsonValue } from '@vibex/plugin-sdk';
import App from '../src/App';
import { setBridge } from '../src/services/bridge';

declare const __VIBEX_CANVAS_CSS__: string;

const STYLE_ID = 'vibex-canvas-styles';

function installCanvasStyles() {
  if (typeof document === 'undefined' || typeof __VIBEX_CANVAS_CSS__ !== 'string') {
    return () => {};
  }
  let style = document.getElementById(STYLE_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = __VIBEX_CANVAS_CSS__;
  return () => style?.remove();
}

export default defineVibeXPlugin({
  apiVersion: '2.0',
  id: 'vibex-canvas',
  activate(ctx) {
    const removeStyles = installCanvasStyles();
    setBridge({
      invoke: (handler, input) => ctx.worker.invoke(handler, input as JsonValue | undefined),
    });

    const CanvasView = () =>
      createElement(
        'div',
        { className: 'vibex-canvas-root' },
        createElement(App),
      );
    ctx.ui.registerTab({
      id: 'canvas-tab',
      title: '生图画板',
      icon: 'sparkles',
      component: CanvasView,
    });
    ctx.ui.registerView({
      id: 'canvas-settings',
      title: '生图画板',
      slot: 'plugin.detail.panel',
      component: CanvasView,
    });

    ctx.effect(() => () => {
      setBridge(null);
      removeStyles();
    });
  },
});
