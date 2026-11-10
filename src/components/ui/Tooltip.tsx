import type { ReactNode } from 'react';
import './Tooltip.css';

export function Tooltip({ content, children, position = 'top' }: {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <span className={`vxt-tip vxt-tip-${position}`} data-tip={content}>
      {children}
    </span>
  );
}
