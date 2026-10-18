import { createRoot } from 'react-dom/client';
import App from '../App';
import '../index.css';

type Environment = {
  invoke: (
    method: string,
    input?: Record<string, unknown> | null
  ) => Promise<unknown>;
};

export function mount(root: HTMLElement, environment?: Environment) {
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
  reactRoot.render(<App />);
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
