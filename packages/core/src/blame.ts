/** 冲突文件 `git blame --line-porcelain` 解析（纯函数；调 git 在 GitService）。 */

export interface BlameCommit {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail?: string;
  summary: string;
  time?: number;
}

export interface ConflictBlameHunk {
  path: string;
  oursRange: [number, number];
  theirsRange: [number, number];
  ours: BlameCommit[];
  theirs: BlameCommit[];
}

export interface ConflictBlameResult {
  path: string;
  into: string;
  from: string;
  hunks: ConflictBlameHunk[];
}

/** porcelain 里每个 commit 去重，按首次出现顺序。 */
export function parseBlamePorcelain(stdout: string): BlameCommit[] {
  if (!stdout.trim()) return [];
  const bySha = new Map<string, BlameCommit>();
  const order: string[] = [];
  let currentSha = '';
  let author = '';
  let authorEmail = '';
  let authorTime: number | undefined;
  let summary = '';

  for (const line of stdout.split('\n')) {
    if (/^[0-9a-f]{40}/.test(line)) {
      currentSha = line.slice(0, 40);
      author = '';
      authorEmail = '';
      authorTime = undefined;
      summary = '';
      continue;
    }
    if (line.startsWith('author ')) {
      author = line.slice('author '.length);
      continue;
    }
    if (line.startsWith('author-mail ')) {
      authorEmail = line.slice('author-mail '.length).replace(/^<|>$/g, '');
      continue;
    }
    if (line.startsWith('author-time ')) {
      const n = Number(line.slice('author-time '.length));
      authorTime = Number.isFinite(n) ? n : undefined;
      continue;
    }
    if (line.startsWith('summary ')) {
      summary = line.slice('summary '.length);
      continue;
    }
    if (line.startsWith('\t') && currentSha && !bySha.has(currentSha)) {
      bySha.set(currentSha, {
        sha: currentSha,
        shortSha: currentSha.slice(0, 7),
        author,
        authorEmail: authorEmail || undefined,
        summary,
        time: authorTime
      });
      order.push(currentSha);
    }
  }
  return order.map((sha) => bySha.get(sha)!);
}

/** `git diff -U0` 新侧 inclusive 行号区间。 */
export function parseNewSideRanges(diff: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(diff)) !== null) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) continue;
    ranges.push([start, start + count - 1]);
  }
  return ranges;
}
