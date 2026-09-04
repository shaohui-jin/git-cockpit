/**
 * OpenAPI / Swagger UI：挂在同一 Fastify 进程的 /docs。
 * REST 摘要集中在此；MCP 工具从 TOOL_DEFS + zod 生成，避免手写 32 份。
 */
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { version } from '../package.json';
import { TOOL_DEFS } from './tools/index.ts';

const REST_META: Record<string, { summary: string; tags: string[] }> = {
  'get /api/health': { summary: '探活', tags: ['系统'] },
  'get /api/repos': { summary: '已打开仓库列表', tags: ['仓库'] },
  'post /api/repos/open': { summary: '打开本地仓库', tags: ['仓库'] },
  'delete /api/repos/{id}': { summary: '关闭并移除仓库', tags: ['仓库'] },
  'post /api/repos/{id}/activate': { summary: '激活仓库（置顶）', tags: ['仓库'] },
  'get /api/repos/{id}/status': { summary: '工作区状态', tags: ['只读'] },
  'get /api/repos/{id}/log': { summary: '提交历史', tags: ['只读'] },
  'get /api/repos/{id}/diff': { summary: '差异', tags: ['只读'] },
  'get /api/repos/{id}/show/{commit}': { summary: '提交详情', tags: ['只读'] },
  'get /api/repos/{id}/branches': { summary: '分支列表', tags: ['只读'] },
  'get /api/repos/{id}/tags': { summary: '标签列表', tags: ['只读'] },
  'get /api/repos/{id}/remotes': { summary: '远程列表', tags: ['只读'] },
  'get /api/repos/{id}/graph': { summary: '提交列表图数据（git log）', tags: ['只读'] },
  'get /api/repos/{id}/branch-graph': { summary: '分支 tip DAG（状态页 G6）', tags: ['只读'] },
  'get /api/repos/{id}/file': { summary: '读取某提交中的文件', tags: ['只读'] },
  'get /api/repos/{id}/stashes': { summary: 'stash 列表', tags: ['只读'] },
  'get /api/repos/{id}/backups': { summary: '高危操作备份分支 / stash', tags: ['只读'] },
  'get /api/repos/{id}/reflog': { summary: 'reflog', tags: ['只读'] },
  'get /api/jobs': { summary: '后台任务列表（克隆等）', tags: ['仓库'] },
  'get /api/jobs/{id}': { summary: '后台任务详情与日志', tags: ['仓库'] },
  'post /api/jobs/clone': { summary: '后台克隆远程仓库', tags: ['仓库'] },
  'get /api/tools': { summary: '工具注册表（含风险与是否启用）', tags: ['系统'] },
  'get /api/logs': { summary: '操作审计日志', tags: ['系统'] },
  'get /api/settings': { summary: '配置与权限', tags: ['设置'] },
  'put /api/settings': { summary: '更新权限或 MR 配置（Token 明文不回读，保存前校验）', tags: ['设置'] },
  'get /api/events': { summary: 'SSE：仓库变化、日志、后台任务进度', tags: ['系统'] }
};

type OpenApiDoc = {
  paths?: Record<string, Record<string, Record<string, unknown> | undefined> | undefined>;
};

function applyRestMeta(spec: OpenApiDoc): void {
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!item) continue;
    for (const method of Object.keys(item)) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const meta = REST_META[`${method} ${path}`];
      if (meta) {
        if (!op.summary) op.summary = meta.summary;
        if (!op.tags) op.tags = meta.tags;
      }
    }
  }
}

function injectToolPaths(spec: OpenApiDoc): void {
  if (!spec.paths) spec.paths = {};
  delete spec.paths['/api/repos/{id}/tools/{tool}'];

  const riskTag = (risk: string): string =>
    risk === 'dangerous' ? '高风险工具' : risk === 'write' ? '写操作工具' : '只读工具';

  for (const def of TOOL_DEFS) {
    const jsonSchema = zodToJsonSchema(def.schema, {
      target: 'openApi3',
      $refStrategy: 'none'
    }) as Record<string, unknown>;
    delete jsonSchema.$schema;

    spec.paths[`/api/repos/{id}/tools/${def.name}`] = {
      post: {
        tags: [riskTag(def.risk)],
        summary: def.name,
        description: def.description,
        operationId: def.name,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: '仓库 id（GET /api/repos）'
          }
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { params: jsonSchema }
              }
            }
          }
        },
        responses: {
          '200': { description: '成功（result 或 dry-run preview）' },
          '400': { description: '失败或参数错误' },
          '403': { description: '工具禁用或需要审批' },
          '404': { description: '未知工具或仓库不存在' }
        }
      }
    };
  }
}

export async function registerApiDocs(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Git Cockpit API',
        description:
          'Web REST。写操作与 MCP 工具均为 POST /api/repos/{id}/tools/{name}，请求体 { params }。MCP 传输 /mcp 不在本文档。',
        version
      }
    },
    exposeHeadRoutes: false,
    transformObject: (doc) => {
      if (!('openapiObject' in doc)) return 'swaggerObject' in doc ? doc.swaggerObject : doc;
      const spec = doc.openapiObject as OpenApiDoc;
      applyRestMeta(spec);
      injectToolPaths(spec);
      return spec;
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true }
  });
}
