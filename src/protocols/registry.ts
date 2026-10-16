import type { ModelCaps, ProtocolId } from '../types';
import { isProtocolId } from '../types';
import { geminiAdapter } from './gemini';
import { gptAdapter, otherAdapter } from './gpt';
import { grokAdapter } from './grok';
import { nanoBananaAdapter } from './nanoBanana';
import type { PanelField, PanelSpec, ProtocolAdapter } from './types';

const ADAPTERS: Record<ProtocolId, ProtocolAdapter> = {
  gpt: gptAdapter,
  grok: grokAdapter,
  'nano-banana': nanoBananaAdapter,
  gemini: geminiAdapter,
  other: otherAdapter,
};

export const PROTOCOL_LIST: { id: ProtocolId; label: string }[] = [
  { id: 'gpt', label: 'GPT' },
  { id: 'grok', label: 'Grok' },
  { id: 'nano-banana', label: 'Nano Banana' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'other', label: '其他' },
];

export function protocolOf(value: unknown): ProtocolId {
  return isProtocolId(value) ? value : 'gpt';
}

export function getAdapter(value: unknown): ProtocolAdapter {
  return ADAPTERS[protocolOf(value)];
}

const GROK_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2', '2:1', '1:2'];
const NANO_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', '1:4', '4:1', '1:8', '8:1'];
const LITE_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

function select(key: string, label: string, values: string[], labels?: Record<string, string>): PanelField {
  return {
    key,
    label,
    kind: 'select',
    visible: true,
    options: values.map((value) => ({ value, label: labels?.[value] ?? value })),
  };
}

export function panelSpec(protocol: ProtocolId, model: string, caps: ModelCaps, format: string): PanelSpec {
  if (protocol === 'grok') {
    const quality = model === 'grok-imagine-image-2.0';
    return {
      maxReferenceImages: 5,
      sendReferences: true,
      allowMask: false,
      allowPartials: false,
      fields: [
        select('aspectRatio', '比例', GROK_RATIOS),
        select('resolution', '分辨率', ['1k', '2k'], { '1k': '1K', '2k': '2K' }),
        ...(quality ? [select('quality', '质量', ['low', 'medium', 'auto'], { low: '低', medium: '中', auto: '自动' })] : []),
      ],
      refNote: '最多发送 5 张。多出来的会留在这里，切回其他协议后仍在。',
    };
  }
  if (protocol === 'nano-banana') {
    const lite = model.includes('flash-lite');
    const legacy = model.includes('2.5-flash-image');
    const pro = model.includes('3-pro-image') || model.includes('pro-image');
    const thinking = lite
      ? ['minimal', 'high']
      : legacy || pro
        ? []
        : ['minimal', 'medium', 'high'];
    const sizes = lite ? ['1K'] : legacy ? [] : model.includes('3.1-flash-image') ? ['512', '1K', '2K', '4K'] : ['1K', '2K', '4K'];
    return {
      maxReferenceImages: legacy ? 3 : lite ? 1 : 14,
      sendReferences: true,
      allowMask: false,
      allowPartials: false,
      fields: [
        select('aspectRatio', '比例', lite ? LITE_RATIOS : NANO_RATIOS),
        ...(sizes.length ? [select('imageSize', '分辨率', sizes)] : []),
        select('mimeType', '格式', ['image/png', 'image/jpeg'], { 'image/png': 'PNG', 'image/jpeg': 'JPEG' }),
        ...(thinking.length ? [select('thinkingLevel', '思考', thinking, { minimal: '较少', medium: '中', high: '较多' })] : []),
      ],
      refNote: lite ? '这个型号不适合多张参考图，本次只发送第一张。' : undefined,
    };
  }
  if (protocol === 'gemini') {
    return {
      maxReferenceImages: 0,
      sendReferences: false,
      allowMask: false,
      allowPartials: false,
      fields: [
        { key: 'size', label: '尺寸', kind: 'size', visible: true },
        select('responseFormat', '返回', ['b64_json', 'url'], { b64_json: '内嵌图片', url: '链接' }),
        select('aspectRatio', '比例', ['1:1', '16:9', '9:16', '4:3', '3:4']),
      ],
      refNote: '当前协议不发送参考图，图片仍保留在任务里。',
    };
  }
  const transparent = protocol === 'gpt' && caps.transparent;
  const extended = protocol === 'gpt' && caps.extendedQuality;
  return {
    maxReferenceImages: 16,
    sendReferences: true,
    allowMask: true,
    allowPartials: true,
    fields: [
      { key: 'size', label: '尺寸', kind: 'size', visible: true },
      select('quality', '质量', extended ? ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] : ['low', 'medium', 'high', 'auto'], {
        low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', auto: '自动',
      }),
      select('outputFormat', '格式', transparent ? ['png', 'webp'] : ['png', 'jpeg', 'webp'], { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' }),
      select('background', '背景', transparent ? ['auto', 'opaque', 'transparent'] : ['auto', 'opaque'], {
        auto: '自动', opaque: '不透明', transparent: '透明',
      }),
      { key: 'compression', label: '压缩', kind: 'range', visible: format !== 'png' },
      { key: 'transparent', label: '透明背景', kind: 'check', visible: transparent, hint: '仅 PNG / WebP' },
    ],
    refNote: extended ? '当前模型已解锁更高质量档位' : undefined,
  };
}
