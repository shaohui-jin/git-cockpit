/**
 * 剥掉 AI 工具自动追加的协作尾注。
 *
 * 背景：Cursor 在提交时会把命令改写成带
 * `--trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"` 的形式，
 * 于是每个提交都多一条 AI 协作者。本仓库的约定是 **Author / Committer
 * 只留仓库主人**（见 CONTRIBUTING.md「提交与推送」）。
 *
 * 为什么用 hook 而不是靠自觉：注入发生在命令行改写层，`--no-verify`
 * 之外没法从提交信息侧感知；写下来又会漏。commit-msg 是唯一能稳定
 * 看到最终提交信息、又能在落盘前改它的位置。
 *
 * 用法（git 传入待写入的提交信息文件路径）：
 *   node scripts/hooks/strip-ai-trailers.mjs .git/COMMIT_EDITMSG
 *
 * 退出码恒为 0：这是清理，不是拦截。拦下来只会逼人 --no-verify，
 * 而 --no-verify 会连带跳过所有别的检查。
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';

/**
 * 要剥掉的尾注。只匹配「AI 工具的署名」，不碰真人的 Co-authored-by。
 *
 * 判据是**名字或邮箱命中 AI 工具特征**，而不是「凡 Co-authored-by 就删」——
 * 后者会把结对编程时真人协作者的署名一起删掉，那是数据损失。
 */
const AI_SIGNATURES = [
  // Cursor: Co-authored-by: Cursor <cursoragent@cursor.com>
  /cursoragent@cursor\.com/i,
  /^\s*co-authored-by:\s*cursor\b/i,
  // Copilot / Claude Code / Codeium 等同类工具的常见形态，一并兜住
  /^\s*co-authored-by:\s*(github\s+)?copilot\b/i,
  /^\s*co-authored-by:\s*claude(\s+code)?\b/i,
  /^\s*co-authored-by:\s*(windsurf|codeium|devin|aider)\b/i,
  // 「Generated with …」类页脚：Cursor / Copilot 都会加，且常带 🤖
  /^\s*(?:🤖\s*)?generated\s+(?:with|by)\s+\[?\s*(cursor|copilot|claude|codeium)/i,
];

/** 这一行是不是该删的尾注 */
export function isAiTrailer(line) {
  return AI_SIGNATURES.some((re) => re.test(line));
}

/**
 * 从提交信息里移除 AI 尾注。
 *
 * 只处理「尾注区」：从最后一段以 `Key: value` 形态出现的块。
 * 正文中间偶然提到 `Co-authored-by:` 的说明文字（比如本仓库的
 * CONTRIBUTING 就写了这条规则）不能被误删——那会让提交信息出现空洞。
 *
 * @param {string} message 完整提交信息
 * @returns {{ message: string, removed: string[] }}
 */
export function stripAiTrailers(message) {
  const eol = message.includes('\r\n') ? '\r\n' : '\n';
  const lines = message.split(/\r?\n/);

  /*
   * 只看「最后一个段落」——正文与尾部页脚之间一定有换行分隔。
   *
   * 为什么不从尾部逐行往上扫 trailer：`Generated with [Cursor](...)` 不是
   * `Key: value` 形态，按 trailer 语法扫会漏掉它。而「最后一段」同时覆盖
   * 两种形态，也不会碰到正文中间（正文里提到 Co-authored-by 的那句在
   * 更靠前的段落里）。
   */
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim() === '') end--;
  if (end < 0) return { message, removed: [] };

  let start = end;
  while (start > 0 && lines[start - 1].trim() !== '') start--;

  const removed = [];
  const kept = [];
  for (let i = start; i <= end; i++) {
    if (isAiTrailer(lines[i])) removed.push(lines[i]);
    else kept.push(lines[i]);
  }
  if (removed.length === 0) return { message, removed: [] };

  /*
   * 重组：最后一个段落之前的内容 + 空行 + 剩下的行。
   * 若整段被删光，尾部不留多余空行——否则提交信息会以空行结尾，
   * `git log` 看起来像多按了一次回车。
   */
  const head = lines.slice(0, start);
  while (head.length && head[head.length - 1].trim() === '') head.pop();

  const out = kept.length ? [...head, '', ...kept] : head;
  return { message: out.join(eol) + eol, removed };
}

/** 命令行入口 */
function main() {
  const file = process.argv[2];
  if (!file) {
    // 没有参数不是错误：可能有人在别处手动跑它
    process.exit(0);
  }

  const original = readFileSync(file, 'utf8');
  const { message, removed } = stripAiTrailers(original);
  if (removed.length === 0) process.exit(0);

  writeFileSync(file, message, 'utf8');
  // 提示走 stderr：stdout 会被 git 吞进编辑器，看不见
  process.stderr.write(
    `[commit-msg] 已移除 ${removed.length} 条 AI 协作尾注（约定：不加 AI 作者）\n`,
  );
  for (const line of removed) process.stderr.write(`[commit-msg]   - ${line.trim()}\n`);
}

/*
 * 只有被当作脚本直接执行时才跑 main，被 import 时保持纯函数可用。
 *
 * 判据是「解析后的真实路径相同」，不用拼 file:// 字符串：Windows 的盘符、
 * 反斜杠、以及 URL 编码都会让字符串比较出错。realpathSync 把两边都归一，
 * 符号链接也一并处理。
 */
const entry = process.argv[1];
if (entry) {
  let same = false;
  try {
    same = realpathSync(entry) === realpathSync(new URL(import.meta.url));
  } catch {
    same = false;
  }
  if (same) main();
}

export { main };
