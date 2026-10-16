import type { ProtocolId, Provider } from '../types';

export interface ImageRequest {
  model: string;
  prompt: string;
  referenceImages: string[];
  maskImage?: string;
  quality?: string;
  size?: string;
  outputFormat?: string;
  background?: string;
  outputCompression?: number;
  partialImages?: number;
  options: Record<string, string | number | boolean>;
  onPartial?: (dataUrl: string, index: number) => void;
}

export interface PanelField {
  key: string;
  label: string;
  kind: 'select' | 'size' | 'range' | 'check';
  options?: { value: string; label: string }[];
  visible: boolean;
  hint?: string;
}

export interface PanelSpec {
  maxReferenceImages: number;
  sendReferences: boolean;
  allowMask: boolean;
  allowPartials: boolean;
  fields: PanelField[];
  refNote?: string;
}

export interface ProtocolAdapter {
  id: ProtocolId;
  label: string;
  requestOne: (provider: Provider, request: ImageRequest) => Promise<{ imageUrls: string[] }>;
}
