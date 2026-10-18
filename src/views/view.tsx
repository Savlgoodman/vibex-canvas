import App from '../App';
import '../index.css';
import * as ReactRuntime from 'react';
import { createElement, useEffect } from 'react';

type Environment = {
  invoke: (
    method: string,
    input?: Record<string, unknown> | null
  ) => Promise<unknown>;
};

export default function CanvasView({
  environment,
}: {
  environment?: Environment;
}) {
  // Latest plugin-cli uses the classic JSX transform for the remote graph.
  const globalScope = globalThis as typeof globalThis & {
    React?: typeof ReactRuntime;
  };
  globalScope.React = ReactRuntime;
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
  useEffect(
    () => () => {
      if (
        bridge &&
        (window as { __vibex_bridge?: unknown }).__vibex_bridge === bridge
      ) {
        delete (window as { __vibex_bridge?: unknown }).__vibex_bridge;
      }
    },
    [bridge]
  );
  return createElement(App);
}
