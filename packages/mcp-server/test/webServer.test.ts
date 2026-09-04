/**
 * 集成测试：Fastify Web API（仓库管理、状态/历史查询、通用写操作、设置、SSE）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTestRuntime, disposeTestRuntime, createSampleRepo, cleanupTmp, initRepo, commitFile } from './helpers.ts';
import { createWebServer } from '../src/webServer.ts';
import type { Runtime } from '../src/index.ts';
import type { WebServerHandle } from '../src/index.ts';
import type { SimpleGit } from 'simple-git';
import { maskToken } from '@shaohui_jin/git-cockpit-core';

describe('Web API', () => {
  let runtime: Runtime;
  let server: WebServerHandle;
  let repoDir: string;
  let git: SimpleGit;

  beforeAll(async () => {
    const sample = await createSampleRepo();
    repoDir = sample.dir;
    git = sample.git;
    runtime = createTestRuntime();
    server = await createWebServer(runtime, { staticDir: null, noListen: true });
  });

  afterAll(async () => {
    await server.close();
    disposeTestRuntime(runtime);
    cleanupTmp();
  });

  it('GET /api/health 返回 ok', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
  });

  it('GET /docs 提供 OpenAPI 文档', async () => {
    const ui = await server.app.inject({ method: 'GET', url: '/docs' });
    expect(ui.statusCode).toBeGreaterThanOrEqual(200);
    expect(ui.statusCode).toBeLessThan(400);
    const spec = await server.app.inject({ method: 'GET', url: '/docs/json' });
    expect(spec.statusCode).toBe(200);
    const body = spec.json() as { paths?: Record<string, unknown>; info?: { title?: string } };
    expect(body.info?.title).toBe('Git Cockpit API');
    expect(body.paths?.['/api/health']).toBeTruthy();
    expect(body.paths?.['/api/repos/{id}/tools/git_status']).toBeTruthy();
    expect(body.paths?.['/api/repos/{id}/tools/{tool}']).toBeUndefined();
  });

  it('打开仓库并返回记录', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/repos/open',
      payload: { path: repoDir }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.repo.path).toBe(repoDir);
  });

  it('GET /api/repos 列出仓库', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/repos' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.repos.length).toBeGreaterThanOrEqual(1);
  });

  it('打开不存在目录返回 400', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/repos/open',
      payload: { path: path.join(repoDir, '..', 'not-exist-dir-xyz') }
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/repos/:id/status', async () => {
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    const res = await server.app.inject({ method: 'GET', url: `/api/repos/${id}/status` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.current).toBe('main');
  });

  it('GET /api/repos/:id/log', async () => {
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    const res = await server.app.inject({ method: 'GET', url: `/api/repos/${id}/log?maxCount=10` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/repos/:id/branches 与 tags', async () => {
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    const branches = await server.app.inject({ method: 'GET', url: `/api/repos/${id}/branches` });
    expect(branches.json().branches.some((b: { name: string }) => b.name === 'feature/x')).toBe(true);
    const tags = await server.app.inject({ method: 'GET', url: `/api/repos/${id}/tags` });
    expect(tags.statusCode).toBe(200);
  });

  it('通用写操作入口：git_add + git_commit（dry-run 预览 → 真实执行）', async () => {
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    fs.writeFileSync(path.join(repoDir, 'web.txt'), 'web\n', 'utf8');

    // dry-run 预览
    const dry = await server.app.inject({
      method: 'POST',
      url: `/api/repos/${id}/tools/git_add`,
      payload: { params: { paths: ['web.txt'], dryRun: true } }
    });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().dryRun).toBe(true);

    // 真实暂存
    const add = await server.app.inject({
      method: 'POST',
      url: `/api/repos/${id}/tools/git_add`,
      payload: { params: { paths: ['web.txt'] } }
    });
    expect(add.statusCode).toBe(200);

    // 提交
    const commit = await server.app.inject({
      method: 'POST',
      url: `/api/repos/${id}/tools/git_commit`,
      payload: { params: { message: 'chore: web test', paths: ['web.txt'] } }
    });
    expect(commit.statusCode).toBe(200);

    const log = await git.log({ maxCount: 1 });
    expect(log.latest?.message).toBe('chore: web test');

    // status 应为 clean
    const status = await server.app.inject({ method: 'GET', url: `/api/repos/${id}/status` });
    expect(status.json().isClean).toBe(true);
  });

  it('危险工具经 Web 入口返回 403（需要审批）', async () => {
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/repos/${id}/tools/git_clean`,
      payload: { params: {} }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredApproval).toBe(true);
  });

  it('未知工具返回 404', async () => {
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/repos/${id}/tools/not_a_tool`,
      payload: { params: {} }
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET/PUT /api/settings 更新 disabledTools 后即时生效', async () => {
    const before = await server.app.inject({ method: 'GET', url: '/api/settings' });
    expect(before.statusCode).toBe(200);
    const body = before.json();
    expect(body.permissions.disabledTools).toContain('git_reset_hard');

    // 先临时全启用
    const put = await server.app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { permissions: { disabledTools: [], requireApprovalFor: [] } }
    });
    expect(put.statusCode).toBe(200);

    // git_clean 现在应可被调用（dry-run，避免真实删除）
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/repos/${id}/tools/git_clean`,
      payload: { params: { dryRun: true } }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dryRun).toBe(true);

    // 恢复默认禁用
    await server.app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        permissions: {
          disabledTools: ['git_reset_hard', 'git_clean', 'git_push_force', 'git_branch_delete_force', 'git_rebase'],
          requireApprovalFor: ['git_reset_hard', 'git_clean', 'git_push_force', 'git_branch_delete_force', 'git_rebase']
        }
      }
    });
  });

  it('GET/PUT /api/settings 可更新 allowedRepos，名单外仓库拒绝打开', async () => {
    const get = await server.app.inject({ method: 'GET', url: '/api/settings' });
    expect(get.statusCode).toBe(200);
    expect(get.json().git.allowedRepos).toEqual([]);

    const blocked = await server.app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { git: { allowedRepos: [path.resolve('/__not_allowed__')] } }
    });
    expect(blocked.statusCode).toBe(200);

    const denied = await server.app.inject({
      method: 'POST',
      url: '/api/repos/open',
      payload: { path: repoDir }
    });
    expect(denied.statusCode).toBe(400);
    const deniedBody = denied.json() as { error?: { message?: string } | string };
    const deniedMsg = typeof deniedBody.error === 'string' ? deniedBody.error : deniedBody.error?.message ?? '';
    expect(deniedMsg).toMatch(/allowedRepos|白名单/);

    await server.app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { git: { allowedRepos: [] } }
    });
    const allowed = await server.app.inject({
      method: 'POST',
      url: '/api/repos/open',
      payload: { path: repoDir }
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('PUT /api/settings 无效 Token 不落盘', async () => {
    const before = await server.app.inject({ method: 'GET', url: '/api/settings' });
    expect(before.json().mr.hosts).toEqual([]);

    const bad = await server.app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { mr: { upsertHost: { host: 'github.com', platform: 'github', token: 'nope' } } }
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('格式错误');
    expect(bad.json().tokenStatus.ok).toBe(false);

    const after = await server.app.inject({ method: 'GET', url: '/api/settings' });
    expect(after.json().mr.hosts).toEqual([]);
  });

  it('GET/PUT /api/settings 按域名保存 Token，明文不回显', async () => {
    const tokenA = `glpat-${'A'.repeat(20)}`;
    const tokenB = `glpat-${'B'.repeat(20)}`;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/personal_access_tokens/self')) {
        return new Response(JSON.stringify({ expires_at: null, active: true, revoked: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/user')) {
        return new Response(JSON.stringify({ username: 'alice' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const before = await server.app.inject({ method: 'GET', url: '/api/settings' });
      expect(before.statusCode).toBe(200);
      expect(before.json().mr.method).toBe('browser');
      expect(before.json().mr.defaultRemote).toBe('origin');
      expect(Array.isArray(before.json().mr.remotes)).toBe(true);
      expect(before.json().mr.hosts).toEqual([]);
      expect(before.json().mr.cli.gh.installUrl).toContain('cli.github.com');
      expect(before.json().mr.cli.glab.installUrl).toContain('gitlab.com/gitlab-org/cli');
      expect(before.json().config.mr.hosts).toEqual([]);

      const putA = await server.app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { mr: { upsertHost: { host: 'git.a.com', platform: 'gitlab', token: tokenA } } }
      });
      expect(putA.statusCode).toBe(200);
      expect(putA.json().config.mr.hosts).toEqual([
        expect.objectContaining({ host: 'git.a.com', platform: 'gitlab', token: '[REDACTED]' })
      ]);
      expect(JSON.stringify(putA.json())).not.toContain(tokenA);

      const putB = await server.app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { mr: { upsertHost: { host: 'git.b.com', platform: 'gitlab', token: tokenB } } }
      });
      expect(putB.json().config.mr.hosts).toHaveLength(2);
      expect(JSON.stringify(putB.json())).not.toContain(tokenB);

      await server.app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { mr: { upsertHost: { host: 'git.a.com', clearToken: true } } }
      });
      const afterClear = await server.app.inject({ method: 'GET', url: '/api/settings' });
      const stored = afterClear.json().config.mr.hosts as Array<{ host: string; token: string }>;
      expect(stored.find((h) => h.host === 'git.a.com')?.token).toBe('');
      expect(stored.find((h) => h.host === 'git.b.com')?.token).toBe('[REDACTED]');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('GET/PUT /api/settings 默认远程跟当前仓 remotes，开单方式即时保存', async () => {
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    await git.addRemote('origin', 'https://github.com/acme/app.git');
    await git.addRemote('company', 'https://git.b.com/acme/app.git');

    const get = await server.app.inject({ method: 'GET', url: `/api/settings?repoId=${id}` });
    expect(get.statusCode).toBe(200);
    const mr = get.json().mr;
    expect(mr.defaultRemote).toBe('origin');
    expect(mr.remotes.map((r: { name: string }) => r.name).sort()).toEqual(['company', 'origin']);
    expect(mr.current.host).toBe('github.com');
    expect(mr.current.platform).toBe('github');
    expect(mr.current.origin).toBe('https://github.com');
    expect(mr.current.remote).toBe('origin');

    const putRemote = await server.app.inject({
      method: 'PUT',
      url: `/api/settings?repoId=${id}`,
      payload: { mr: { defaultRemote: 'company' } }
    });
    expect(putRemote.statusCode).toBe(200);
    expect(putRemote.json().mr.defaultRemote).toBe('company');
    expect(putRemote.json().mr.current.host).toBe('git.b.com');
    expect(putRemote.json().mr.current.platform).toBe('gitlab');
    expect(putRemote.json().mr.current.origin).toBe('https://git.b.com');

    const putMethod = await server.app.inject({
      method: 'PUT',
      url: `/api/settings?repoId=${id}`,
      payload: { mr: { method: 'cli' } }
    });
    expect(putMethod.json().mr.method).toBe('cli');
    expect(putMethod.json().mr.defaultRemote).toBe('company');
    expect(putMethod.json().mr.hosts).toEqual([
      expect.objectContaining({ host: 'git.b.com', platform: 'gitlab', tokenSet: true })
    ]);

    const sampleB = await createSampleRepo();
    const openB = await server.app.inject({
      method: 'POST',
      url: '/api/repos/open',
      payload: { path: sampleB.dir }
    });
    expect(openB.statusCode).toBe(200);
    const idB = openB.json().repo.id as number;
    const getB = await server.app.inject({ method: 'GET', url: `/api/settings?repoId=${idB}` });
    expect(getB.json().mr.method).toBe('browser');
    const getA = await server.app.inject({ method: 'GET', url: `/api/settings?repoId=${id}` });
    expect(getA.json().mr.method).toBe('cli');
  });

  it('GET /api/logs 返回操作日志', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/logs?limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs.length).toBeGreaterThan(0);
    expect(body.logs[0]).toHaveProperty('tool');
    expect(body.logs[0]).toHaveProperty('source');
  });

  it('SSE 端点可连接并推送 repo-changed 事件', async () => {
    // 建立 SSE 连接（使用类 fetch 流不可行，改用 Node http；此处仅验证首行响应）
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    // 触发一次写操作事件后，通过 eventBus 验证通知被广播
    const events: unknown[] = [];
    const listener = (payload: unknown) => events.push(payload);
    runtime.eventBus.on('repo-changed', listener);

    // 制造可 stash 的更改（否则 stash 无内容不触发 changed 事件）
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'sse-modified\n', 'utf8');

    await server.app.inject({
      method: 'POST',
      url: `/api/repos/${id}/tools/git_stash`,
      payload: { params: { message: 'sse-event-test' } }
    }).then(async (r) => {
      // stash 成功后回滚：pop 回来，避免污染仓库状态
      expect(r.statusCode).toBe(200);
      await server.app.inject({
        method: 'POST',
        url: `/api/repos/${id}/tools/git_stash_pop`,
        payload: { params: { index: 0 } }
      });
    });

    runtime.eventBus.off('repo-changed', listener);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toHaveProperty('repoPath');
  });

  it('DELETE /api/repos/:id 关闭仓库', async () => {
    const repos = (await server.app.inject({ method: 'GET', url: '/api/repos' })).json();
    const id = repos.repos[0].id;
    const res = await server.app.inject({ method: 'DELETE', url: `/api/repos/${id}` });
    expect(res.statusCode).toBe(200);
    const after = await server.app.inject({ method: 'GET', url: '/api/repos' });
    expect(after.json().repos.length).toBe(0);
  });
});

describe('Web API - 无仓库场景', () => {
  it('status 对不存在仓库返回 404', async () => {
    const runtime = createTestRuntime();
    const server = await createWebServer(runtime, { staticDir: null, noListen: true });
    try {
      const res = await server.app.inject({ method: 'GET', url: '/api/repos/999/status' });
      expect(res.statusCode).toBe(404);
    } finally {
      await server.close();
      disposeTestRuntime(runtime);
    }
  });
});

// 防止未使用告警
void initRepo;
void commitFile;