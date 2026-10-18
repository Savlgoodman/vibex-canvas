import App from '../App';
import '../index.css';
import { createElement } from 'react';

type Environment = {
  invoke: (
    method: string,
    input?: Record<string, unknown> | null
  ) => Promise<unknown>;
};

export async function mount(root: HTMLElement, environment?: Environment) {
  const { createRoot } = await import('react-dom/client');
  const bridge = environment
    ? {
        invoke: (handler: string, input?: unknown) =>
          environment.invoke(
            handler,
            (input ?? undefined) as Record<string, unknown> | undefined
          ),
      }
    : undefined;
  if (bridge) (window as { __vibex_bridge?: unknown }).__vibex_bridge = bridge;

  const reactRoot = createRoot(root);
  reactRoot.render(createElement(App));
  return () => {
    reactRoot.unmount();
    if (
      bridge &&
      (window as { __vibex_bridge?: unknown }).__vibex_bridge === bridge
    ) {
      delete (window as { __vibex_bridge?: unknown }).__vibex_bridge;
    }
  };
}
