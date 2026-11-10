export interface ModelCaps {
  transparent: boolean;
  extendedQuality: boolean;
}

export const PROTOCOL_IDS = ['gpt', 'grok', 'nano-banana', 'gemini', 'other'] as const;
export type ProtocolId = (typeof PROTOCOL_IDS)[number];

export function isProtocolId(value: unknown): value is ProtocolId {
  return typeof value === 'string' && (PROTOCOL_IDS as readonly string[]).includes(value);
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** Wire dialect. Missing values from older saves are treated as gpt. */
  protocol?: ProtocolId;
  /** Per-model overrides. Missing entries fall back to name detection. */
  modelCaps?: Record<string, ModelCaps>;
  isDefault?: boolean;
}

export interface AppSettings {
  /** Stream up to 3 partial images while generating. */
  partialImages: boolean;
  /** Max image requests in flight at once. */
  maxConcurrent: number;
  /** Max image requests started in any rolling 60 seconds. */
  maxPerMinute: number;
  /** Collapse advanced params (size, quality, etc.) by default. */
  collapseAdvancedParams: boolean;
}

export interface Task {
  id: string;
  title: string;
  thumbnailUrl?: string;
  providerId: string;
  model: string;
  size: string;
  quality: string;
  outputFormat?: OutputFormat;
  background?: ImageBackground;
  outputCompression?: number;
  imageCount?: number;
  /** Protocol-specific controls. Keys from other protocols are kept when switching. */
  protocolOptions?: Record<string, string | number | boolean>;
  records: GenRecord[];
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GenRecord {
  id: string;
  taskId: string;
  prompt: string;
  providerId: string;
  model: string;
  size: string;
  quality: string;
  outputFormat?: OutputFormat;
  background?: ImageBackground;
  outputCompression?: number;
  protocolOptions?: Record<string, string | number | boolean>;
  /** @deprecated single reference kept for older records */
  referenceImage?: string;
  referenceImages?: string[];
  maskImage?: string;
  status: 'pending' | 'success' | 'failed';
  /** How many images this generation asked for. */
  count?: number;
  imageUrl?: string;
  imageUrls?: string[];
  error?: string;
  createdAt: number;
}

export interface AppState {
  providers: Provider[];
  tasks: Task[];
  activeTaskId: string | null;
}

/** A generation made through the Skill (Agent), not the Tab UI. */
export interface AgentRecord {
  id: string;
  prompt: string;
  providerId: string;
  model: string;
  size: string;
  quality?: string;
  outputFormat?: OutputFormat;
  background?: ImageBackground;
  status: 'success' | 'failed';
  /** Absolute paths on disk. May point at files the user has since deleted. */
  imagePaths: string[];
  source: 'agent';
  outputDir: string | null;
  createdAt: number;
}

/** Records grouped by the outputDir they were written to. */
export type AgentRecordGroups = Record<string, AgentRecord[]>;

/**
 * Agent records are stored by absolute file path, while the rest of the app
 * reads `imageUrl`/`imageUrls` markers. `useImageUrl` resolves `file:` markers
 * through `image.getImage`, so projecting the paths here is all that is needed
 * to make a Skill generation render like any other record.
 */
export function agentRecordImages(record: { imagePaths?: string[] }): string[] {
  return (record.imagePaths ?? []).filter(Boolean).map((p) => `file:${p}`);
}

/** Reserved group key for Agent generations made without an --outputDir. */
export const DEFAULT_AGENT_GROUP = '__default__';

export const SIZE_PRESETS = [
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
  'auto',
];

export const QUALITY_OPTIONS = ['low', 'medium', 'high', 'auto'];
export const EXTENDED_QUALITY_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];

export type OutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageBackground = 'auto' | 'opaque' | 'transparent';

export const OUTPUT_FORMATS: OutputFormat[] = ['png', 'jpeg', 'webp'];
export const BACKGROUNDS: ImageBackground[] = ['auto', 'opaque', 'transparent'];

export const BATCH_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function recordImages(record: { imageUrls?: string[]; imageUrl?: string }): string[] {
  if (record.imageUrls?.length) return record.imageUrls;
  if (record.imageUrl) return [record.imageUrl];
  return [];
}

export function recordReferenceImages(record: { referenceImages?: string[]; referenceImage?: string }): string[] {
  if (record.referenceImages?.length) return record.referenceImages;
  if (record.referenceImage) return [record.referenceImage];
  return [];
}
