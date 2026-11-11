import { createElement } from 'react';
import { defineVibeXPlugin } from '@vibex/plugin-sdk';
import type { JsonValue } from '@vibex/plugin-sdk';
import App from '../src/App';
import { setBridge } from '../src/services/bridge';

export default defineVibeXPlugin({
  apiVersion: '2.0',
  id: 'vibex-canvas',
  activate(ctx) {
    setBridge({
      invoke: (handler, input) => ctx.worker.invoke(handler, input as JsonValue | undefined),
    });

    const CanvasView = () => createElement(App);
    ctx.ui.registerTab({
      id: 'canvas-tab',
      title: '生图画板',
      icon: 'image',
      component: CanvasView,
    });
    ctx.ui.registerView({
      id: 'canvas-settings',
      title: '生图画板',
      slot: 'plugin.detail.panel',
      component: CanvasView,
    });

    ctx.effect(() => () => setBridge(null));
  },
});
