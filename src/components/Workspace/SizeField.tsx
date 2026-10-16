import { useEffect, useState } from 'react';
import { SIZE_PRESETS } from '../../types';
import { SelectMenu } from '../ui/SelectMenu';

interface Props {
  value: string;
  onChange: (size: string) => void;
}

export function SizeField({ value, onChange }: Props) {
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [bubble, setBubble] = useState('');

  useEffect(() => {
    const parsed = parseSize(value);
    setWidth(parsed ? String(parsed.w) : '');
    setHeight(parsed ? String(parsed.h) : '');
  }, [value]);

  useEffect(() => {
    if (!bubble) return;
    const timer = window.setTimeout(() => setBubble(''), 2600);
    return () => window.clearTimeout(timer);
  }, [bubble]);

  const applyCustom = (close: () => void) => {
    const rawW = Number(width);
    const rawH = Number(height);
    if (!rawW || !rawH) {
      setBubble('请填写宽度和高度');
      return;
    }
    const w = snap16(rawW);
    const h = snap16(rawH);
    if (w !== rawW || h !== rawH) setBubble(`已自动为您调整为 ${w} × ${h}`);
    onChange(`${w}x${h}`);
    close();
  };

  const options = SIZE_PRESETS.map((size) => ({
    value: size,
    label: size === 'auto' ? '自动' : size.replace('x', ' × '),
  }));
  if (!SIZE_PRESETS.includes(value as typeof SIZE_PRESETS[number])) {
    options.push({ value, label: value.replace('x', ' × ') });
  }

  return (
    <div className="size-field">
      <SelectMenu
        wide
        value={value}
        options={options}
        onChange={onChange}
        footer={(close) => (
          <div className="size-custom">
            <label>
              宽
              <input
                className="size-custom-input"
                inputMode="numeric"
                value={width}
                placeholder="1536"
                onChange={(e) => setWidth(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCustom(close); }}
              />
            </label>
            <label>
              高
              <input
                className="size-custom-input"
                inputMode="numeric"
                value={height}
                placeholder="864"
                onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCustom(close); }}
              />
            </label>
            <button type="button" className="size-custom-apply" onClick={() => applyCustom(close)}>确定</button>
          </div>
        )}
      />
      {bubble && <div className="param-bubble">{bubble}</div>}
    </div>
  );
}

function parseSize(raw: string): { w: number; h: number } | null {
  const match = raw.trim().toLowerCase().match(/^(\d+)\s*[x×*]\s*(\d+)$/);
  if (!match) return null;
  return { w: Number(match[1]), h: Number(match[2]) };
}

function snap16(n: number): number {
  return Math.max(16, Math.round(n / 16) * 16);
}
