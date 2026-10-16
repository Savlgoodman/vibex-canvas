import type { ProtocolId } from '../../types';
import gpt from '../../assets/protocols/gpt.svg?raw';
import grok from '../../assets/protocols/grok.svg?raw';
import gemini from '../../assets/protocols/gemini.svg?raw';
import nanoBanana from '../../assets/protocols/nano-banana.svg?raw';
import other from '../../assets/protocols/other.svg?raw';
import './ProtocolIcon.css';

const ICONS: Record<ProtocolId, string> = {
  gpt,
  grok,
  gemini,
  'nano-banana': nanoBanana,
  other,
};

export function ProtocolIcon({ protocol, size = 16 }: { protocol: ProtocolId; size?: number }) {
  return (
    <span
      className="protocol-icon"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: ICONS[protocol] }}
    />
  );
}
