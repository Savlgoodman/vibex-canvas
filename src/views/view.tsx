import { definePluginApp } from '@vibex/plugin-sdk/app';

export default definePluginApp(({ bridge, root, signal }) => {
  root.innerHTML = '<div style="padding:16px;color:#666">生图画板加载中...</div>';

  const dispose = () => {
    root.innerHTML = '';
  };

  signal.addEventListener('abort', dispose);
  bridge.ready();

  return dispose;
});
