import { useRef, type MouseEvent } from 'react';

/** Close only when the press and the release both happen on the backdrop. */
export function useBackdropDismiss(onClose: () => void) {
  const pressedOnBackdrop = useRef(false);
  return {
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      pressedOnBackdrop.current = event.target === event.currentTarget;
    },
    onMouseUp: (event: MouseEvent<HTMLElement>) => {
      const shouldClose = pressedOnBackdrop.current && event.target === event.currentTarget;
      pressedOnBackdrop.current = false;
      if (shouldClose) onClose();
    },
  };
}
