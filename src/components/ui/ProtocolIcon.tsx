import type { ProtocolId } from '../../types';

const ICONS: Record<ProtocolId, { path: string; fill?: string }> = {
  gpt: {
    path: 'M12 1.5c.8 3.3 2.7 5.7 6 7.3-3.3 1.6-5.2 4-6 7.3-.8-3.3-2.7-5.7-6-7.3 3.3-1.6 5.2-4 6-7.3Z',
    fill: '#3186FF',
  },
  grok: {
    path: 'M4 4.5 20 19.5M5 19 19 5M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Z',
  },
  gemini: {
    path: 'M12 1.5c.8 3.3 2.7 5.7 6 7.3-3.3 1.6-5.2 4-6 7.3-.8-3.3-2.7-5.7-6-7.3 3.3-1.6 5.2-4 6-7.3Z',
    fill: '#FABC12',
  },
  'nano-banana': {
    path: 'M3 19.5c2.4-3.3 4.2-4.7 5.4-6.6C9.7 11 9 8 11.8 7.5c3.7-.7 5.2 7 2.8 10.1-2.1 2.6-6.2 2.4-11.6 1.9Zm10.2-7h7.3',
    fill: '#F9C23C',
  },
  other: {
    path: 'M8 12h8M12 8v8',
  },
};

export function ProtocolIcon({ protocol, size = 16 }: { protocol: ProtocolId; size?: number }) {
  const icon = ICONS[protocol];
  return <span className="protocol-icon" style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }}>
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={icon.fill ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: size, height: size, display: 'block' }}>
      <path d={icon.path} fill={icon.fill || 'currentColor'} style={icon.fill ? { fill: icon.fill } : undefined} />
    </svg>
  </span>;
}
