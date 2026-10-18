import App from '../App';
import '../index.css';
import * as ReactRuntime from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

type Environment = {
  invoke: (
    method: string,
    input?: Record<string, unknown> | null
  ) => Promise<unknown>;
};

export function mount(root: HTMLElement, environment?: Environment) {
  // Latest plugin-cli uses the classic JSX transform for the remote graph.
  const globalScope = globalThis as typeof globalThis & {
    React?: typeof ReactRuntime;
  };
  globalScope.React ??= ReactRuntime;
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
