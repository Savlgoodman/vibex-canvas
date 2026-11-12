import { useId } from 'react';
import type { ProtocolId } from '../../types';
import { PROTOCOL_ICON_SVG } from './protocolIconSvg';

const ICONS: Record<ProtocolId, string> = PROTOCOL_ICON_SVG;

const PAINT_PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-rule',
  'clip-rule',
];

function uniquifyIds(svg: string, id: string) {
  return svg
    .replace(/\bid="([^"]+)"/g, (_, name) => `id="${id}-${name}"`)
    .replace(/url\(#([^)]+)\)/g, (_, name) => `url(#${id}-${name})`);
}

function inheritSvgPaint(svg: string) {
  const svgTag = svg.match(/<svg\b([^>]*)>/);
  if (!svgTag) return svg;
  const inherited = PAINT_PROPS.flatMap((prop) => {
    const match = svgTag[1].match(new RegExp(`${prop}:([^;"]+)`));
    return match ? [[prop, match[1]] as const] : [];
  });
  if (!inherited.length) return svg;
  return svg.replace(/<(circle|path|rect|polygon|polyline)([^>]*?)(\/?)>/g, (full, tag: string, attrs: string, close: string) => {
    const missing = inherited.filter(([prop]) => !attrs.includes(`${prop}:`) && !new RegExp(`\\s${prop}="`).test(attrs));
    if (!missing.length) return full;
    const extra = missing.map(([prop, value]) => `${prop}:${value}`).join(';');
    if (attrs.includes(' style="')) {
      return `<${tag}${attrs.replace(' style="', ` style="${extra};`)}${close}>`;
    }
    return `<${tag}${attrs} style="${extra}"${close}>`;
  });
}

function lockPaint(svg: string, size: number) {
  return svg.replace(/<([A-Za-z]+)([^>]*?)(\/?)>/g, (full, tag: string, attrs: string, close: string) => {
    const paints = PAINT_PROPS.flatMap((prop) => {
      const match = attrs.match(new RegExp(`\\s${prop}="([^"]*)"`));
      return match ? [`${prop}:${match[1]}`] : [];
    });
    if (tag === 'svg') {
      paints.push(`width:${size}px`, `height:${size}px`, 'display:block', 'overflow:visible');
    }
    if (!paints.length) return full;
    if (attrs.includes(' style="')) {
      return `<${tag}${attrs.replace(' style="', ` style="${paints.join(';')};`)}${close}>`;
    }
    return `<${tag}${attrs} style="${paints.join(';')}"${close}>`;
  });
}

export function ProtocolIcon({ protocol, size = 16 }: { protocol: ProtocolId; size?: number }) {
  const uid = useId().replace(/:/g, '');
  const html = inheritSvgPaint(lockPaint(uniquifyIds(ICONS[protocol], uid), size));
  return (
    <span
      className="protocol-icon"
      style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
