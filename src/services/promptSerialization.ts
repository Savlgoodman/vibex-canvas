export type PromptSegment =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; hash: string }
  | { kind: 'comment'; hash: string; lines: string };

const REF_RE = /\[@([0-9a-f]{16})\]/g;
const COMMENT_RE = /'''comment-([0-9a-f]{16})\n([\s\S]*?)'''/g;

export function parsePrompt(input: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let last = 0;
  // Find all matches of both patterns, process in order
  const matches: Array<{ index: number; length: number; segment: PromptSegment }> = [];

  let m: RegExpExecArray | null;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(input)) !== null) {
    matches.push({ index: m.index, length: m[0].length, segment: { kind: 'ref', hash: m[1] } });
  }
  COMMENT_RE.lastIndex = 0;
  while ((m = COMMENT_RE.exec(input)) !== null) {
    matches.push({ index: m.index, length: m[0].length, segment: { kind: 'comment', hash: m[1], lines: m[2] } });
  }

  matches.sort((a, b) => a.index - b.index);

  for (const match of matches) {
    if (match.index < last) continue; // overlapping, skip
    if (match.index > last) {
      segments.push({ kind: 'text', value: input.slice(last, match.index) });
    }
    segments.push(match.segment);
    last = match.index + match.length;
  }

  if (last < input.length) {
    segments.push({ kind: 'text', value: input.slice(last) });
  }

  return segments;
}

export function serializePromptToAPI(segments: PromptSegment[], orderedHashes: string[]): string {
  return segments
    .map((seg) => {
      if (seg.kind === 'text') return seg.value;
      if (seg.kind === 'ref') {
        const idx = orderedHashes.indexOf(seg.hash);
        return idx >= 0 ? `Image ${idx + 1}` : '[deleted]';
      }
      if (seg.kind === 'comment') return seg.lines;
      return '';
    })
    .join('');
}

export function buildPromptText(segments: PromptSegment[]): string {
  return segments
    .map((seg) => {
      if (seg.kind === 'text') return seg.value;
      if (seg.kind === 'ref') return `[@${seg.hash}]`;
      if (seg.kind === 'comment') return `'''comment-${seg.hash}\n${seg.lines}'''`;
      return '';
    })
    .join('');
}

export function insertComment(segments: PromptSegment[], hash: string, lines: string): PromptSegment[] {
  const filtered = segments.filter((s) => !(s.kind === 'comment' && s.hash === hash));
  // Append at end
  return [...filtered, { kind: 'comment', hash, lines }];
}

export function removeComment(segments: PromptSegment[], hash: string): PromptSegment[] {
  return segments.filter((s) => !(s.kind === 'comment' && s.hash === hash));
}

export function hasUnresolvedRefs(segments: PromptSegment[], orderedHashes: string[]): boolean {
  return segments.some((s) => s.kind === 'ref' && !orderedHashes.includes(s.hash));
}
