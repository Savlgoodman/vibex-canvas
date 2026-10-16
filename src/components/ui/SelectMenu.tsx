import { useEffect, useRef, useState, type ReactNode } from 'react';
import './SelectMenu.css';

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  wide?: boolean;
  footer?: (close: () => void) => ReactNode;
}

export function SelectMenu({ value, options, onChange, wide, footer }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`select-menu ${wide ? 'select-menu-wide' : ''} ${open ? 'open' : ''}`} ref={rootRef}>
      <button type="button" className="select-menu-btn" onClick={() => setOpen((v) => !v)}>
        <span className="select-menu-value">
          {selected?.icon}
          <span className="select-menu-label">{selected?.label ?? value}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="select-menu-pop">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`select-menu-option ${option.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.icon}
              <span className="select-menu-label">{option.label}</span>
            </button>
          ))}
          {footer?.(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
