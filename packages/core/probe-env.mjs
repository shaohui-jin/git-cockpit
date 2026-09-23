import { simpleGit } from 'simple-git';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'test', 'tmp', 'probe-env');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const init = simpleGit({ baseDir: dir });
await init.init(['-b', 'main']);
await init.addConfig('user.email', 't@e.com');
await init.addConfig('user.name', 'T');
fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
await init.add('a.txt');
await init.commit('init');

console.log('process.env.GIT_PAGER =', JSON.stringify(process.env.GIT_PAGER));
console.log('process.env.GIT_TERMINAL_PROMPT(before) =', JSON.stringify(process.env.GIT_TERMINAL_PROMPT));

// 方案：进程级设置（不碰 simple-git 的 env()）
process.env.GIT_TERMINAL_PROMPT = '0';

async function tryRaw(label, mutate) {
  const g = simpleGit({ baseDir: dir, binary: 'git' });
  if (mutate) mutate(g);
  try {
    const out = await g.raw(['rev-parse', '--show-toplevel']);
    console.log(`${label} => OK:`, out.trim());
  } catch (e) {
    console.log(`${label} => FAIL:`, e.message);
  }
}

await tryRaw('进程级 env（默认继承）      ', null);
await tryRaw('旧的 .env({...process.env})', (g) => g.env({ ...process.env, GIT_TERMINAL_PROMPT: '0' }));
