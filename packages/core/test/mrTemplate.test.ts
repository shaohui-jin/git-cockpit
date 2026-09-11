import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  normalizeMrConfig,
  parseMrTemplateMarkdown,
  renderMrTemplate,
  resolveMrCreateBody,
  validateMrTemplateFields
} from '../src/index.ts';

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mr-default.md'), 'utf8');

describe('parseMrTemplateMarkdown', () => {
  it('把 Default.md 拆成可填字段，表格与引用不进表单', () => {
    const t = parseMrTemplateMarkdown(fixture, 'Default.md');
    expect(t.filename).toBe('Default.md');
    expect(t.enabled).toBe(true);
    expect(t.agentFill).toBe('allow');
    expect(t.fields.map((f) => [f.id, f.type])).toEqual([
      ['purpose', 'textarea'],
      ['changes', 'textarea'],
      ['self_review', 'select'],
      ['verification', 'checkboxes'],
      ['review_notes', 'textarea'],
      ['preflight', 'checkboxes'],
      ['preflight_note', 'markdown']
    ]);
    expect(t.fields.find((f) => f.id === 'self_review')?.options).toEqual(['低', '中', '高']);
    expect(t.fields.find((f) => f.id === 'verification')?.items?.map((i) => i.required)).toEqual([
      false,
      false,
      false
    ]);
    expect(t.fields.find((f) => f.id === 'preflight')?.items?.every((i) => i.required)).toBe(true);
    const note = t.fields.find((f) => f.id === 'preflight_note');
    expect(note?.content).toContain('AI Coding Review');
    expect(note?.content).toContain('| 情况 |');
    expect(t.fields.some((f) => f.label.includes('Job'))).toBe(false);
  });

  it('无标题的说明段标成 markdown', () => {
    const t = parseMrTemplateMarkdown('> 只是说明\n\n## 原因\n\n<!-- 写原因 -->\n');
    expect(t.fields[0]).toMatchObject({ type: 'markdown', content: '> 只是说明' });
    expect(t.fields[1]).toMatchObject({ type: 'textarea', label: '原因' });
  });
});

describe('render / validate', () => {
  it('按字段渲染，缺必填时校验失败', () => {
    const t = parseMrTemplateMarkdown(fixture, 'Default.md');
    const empty = validateMrTemplateFields(t, {});
    expect(empty.ok).toBe(false);
    expect(empty.missing.map((m) => m.id)).toContain('purpose');
    expect(empty.missing.map((m) => m.id)).toContain('self_review');

    const values = {
      purpose: '修导入',
      changes: '- 解析 MD',
      self_review: '低',
      verification: ['verification_1'],
      review_notes: '看解析',
      preflight: {
        preflight_1: true,
        preflight_2: true,
        preflight_3: true,
        preflight_4: true,
        preflight_5: true
      }
    };
    expect(validateMrTemplateFields(t, values).ok).toBe(true);
    const body = renderMrTemplate(t, values);
    expect(body).toContain('## 变更目的');
    expect(body).toContain('修导入');
    expect(body).toContain('- 风险等级：低');
    expect(body).toContain('- [x] 单元测试已通过');
    expect(body).toContain('| `low` |');
  });
});

describe('resolveMrCreateBody', () => {
  it('未启用时用传入的 body', () => {
    expect(resolveMrCreateBody(null, undefined, 'hello')).toBe('hello');
    const t = parseMrTemplateMarkdown(fixture, 'Default.md');
    t.enabled = false;
    expect(resolveMrCreateBody(t, undefined, 'plain')).toBe('plain');
  });

  it('启用时缺 fields 或必填则拒绝，齐了则渲染', () => {
    const t = parseMrTemplateMarkdown(fixture, 'Default.md');
    expect(() => resolveMrCreateBody(t, undefined)).toThrow(/fields/);
    expect(() => resolveMrCreateBody(t, {})).toThrow(/未填完整/);
    const values = {
      purpose: '修导入',
      changes: '- 解析 MD',
      self_review: '低',
      review_notes: '看解析',
      preflight: {
        preflight_1: true,
        preflight_2: true,
        preflight_3: true,
        preflight_4: true,
        preflight_5: true
      }
    };
    const body = resolveMrCreateBody(t, values, '应被忽略');
    expect(body).toContain('修导入');
    expect(body).not.toContain('应被忽略');
  });
});

describe('normalizeMrConfig.template', () => {
  it('空对象没有模板；合法字段会保留', () => {
    expect(normalizeMrConfig({}).template).toBeNull();
    const n = normalizeMrConfig({
      template: {
        enabled: true,
        agentFill: 'forbid',
        filename: 'Default.md',
        sourceMd: '# x',
        fields: [{ id: 'purpose', type: 'textarea', label: '变更目的', required: true }]
      }
    });
    expect(n.template?.enabled).toBe(true);
    expect(n.template?.agentFill).toBe('forbid');
    expect(n.template?.fields).toHaveLength(1);
  });
});
