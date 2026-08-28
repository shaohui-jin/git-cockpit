/** 冲突块选边：ours = 合入目标，theirs = 我的分支，base = 共同祖先 */

export type ConflictChoice = 'ours' | 'theirs' | 'base';

export interface TextSegment {
  id: string;
  type: 'text';
  content: string;
}

export interface ConflictSegment {
  id: string;
  type: 'conflict';
  ours: string;
  base: string;
  theirs: string;
  choice: ConflictChoice | null;
}

export type MergeSegment = TextSegment | ConflictSegment;

const RE_START = /^<<<<<<<(?:\s+(.*))?$/;
const RE_BASE = /^\|\|\|\|\|\|\|(?:\s+(.*))?$/;
const RE_MID = /^=======/;
const RE_END = /^>>>>>>>(?:\s+(.*))?$/;

/** 解析带冲突标记的文本（diff3）。无标记且两侧不同时整文件当作一块冲突。 */
export function parseConflictContent(
  raw: string | null | undefined,
  fallback?: { ours?: string | null; theirs?: string | null; base?: string | null }
): MergeSegment[] {
  if (raw && raw.includes('超出展示上限')) {
    return [
      {
        id: 'c-0',
        type: 'conflict',
        ours: fallback?.ours ?? '',
        base: fallback?.base ?? '',
        theirs: fallback?.theirs ?? '',
        choice: null
      }
    ];
  }
  if (raw) {
    const segs = parseMarkers(raw);
    if (segs.some((s) => s.type === 'conflict')) return segs;
  }
  const ours = fallback?.ours ?? '';
  const theirs = fallback?.theirs ?? '';
  const base = fallback?.base ?? '';
  if (ours === theirs && (raw == null || raw === '')) {
    return ours ? [{ id: 't-0', type: 'text', content: ours }] : [];
  }
  if (ours !== theirs || (ours === '' && theirs === '' && base !== '')) {
    return [
      {
        id: 'c-0',
        type: 'conflict',
        ours,
        base,
        theirs,
        choice: null
      }
    ];
  }
  return ours ? [{ id: 't-0', type: 'text', content: ours }] : [];
}

function parseMarkers(raw: string): MergeSegment[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const segments: MergeSegment[] = [];
  let i = 0;
  let textBuf: string[] = [];
  let conflictIdx = 0;

  const flushText = (): void => {
    if (textBuf.length === 0) return;
    const content = textBuf.join('\n');
    textBuf = [];
    if (content.length === 0) return;
    segments.push({ id: `t-${segments.length}`, type: 'text', content });
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (RE_START.test(line)) {
      flushText();
      i += 1;
      const oursLines: string[] = [];
      while (i < lines.length && !RE_BASE.test(lines[i] ?? '') && !RE_MID.test(lines[i] ?? '')) {
        oursLines.push(lines[i] ?? '');
        i += 1;
      }
      const baseLines: string[] = [];
      if (i < lines.length && RE_BASE.test(lines[i] ?? '')) {
        i += 1;
        while (i < lines.length && !RE_MID.test(lines[i] ?? '')) {
          baseLines.push(lines[i] ?? '');
          i += 1;
        }
      }
      if (i < lines.length && RE_MID.test(lines[i] ?? '')) i += 1;
      const theirsLines: string[] = [];
      while (i < lines.length && !RE_END.test(lines[i] ?? '')) {
        theirsLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length && RE_END.test(lines[i] ?? '')) i += 1;
      segments.push({
        id: `c-${conflictIdx++}`,
        type: 'conflict',
        ours: oursLines.join('\n'),
        base: baseLines.join('\n'),
        theirs: theirsLines.join('\n'),
        choice: null
      });
      continue;
    }
    textBuf.push(line);
    i += 1;
  }
  flushText();
  return segments;
}

/** 按选边拼出解决后的文件正文 */
export function applyChoices(segments: MergeSegment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'text') {
      parts.push(seg.content);
      continue;
    }
    if (seg.choice === 'ours') parts.push(seg.ours);
    else if (seg.choice === 'theirs') parts.push(seg.theirs);
    else if (seg.choice === 'base') parts.push(seg.base);
    else {
      parts.push(
        ['<<<<<<< ours', seg.ours, '||||||| base', seg.base, '=======', seg.theirs, '>>>>>>> theirs'].join('\n')
      );
    }
  }
  return parts.join('\n');
}

export function countConflicts(segments: MergeSegment[]): { total: number; resolved: number } {
  const conflicts = segments.filter((s): s is ConflictSegment => s.type === 'conflict');
  return { total: conflicts.length, resolved: conflicts.filter((c) => c.choice != null).length };
}
