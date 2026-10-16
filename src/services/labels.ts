import type { ImageBackground, OutputFormat } from '../types';

export const QUALITY_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
  auto: '自动',
};

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
};

export const BACKGROUND_LABELS: Record<ImageBackground, string> = {
  auto: '自动',
  opaque: '不透明',
  transparent: '透明',
};
