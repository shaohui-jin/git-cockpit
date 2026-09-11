import type {
  MrTemplate,
  MrTemplateAgentFill,
  MrTemplateCheckboxItem,
  MrTemplateField,
  MrTemplateFieldType,
  MrTemplateValues,
  PublicMrTemplate
} from './types.ts';
import { GitOperationError } from './types.ts';

export const MAX_MR_TEMPLATE_MD = 256 * 1024;
export const MAX_MR_TEMPLATE_FIELDS = 48;

const KNOWN_IDS: Record<string, string> = {
  变更目的: 'purpose',
  主要改动: 'changes',
  开发者自评: 'self_review',
  本次提交的验证方式: 'verification',
  评审提示: 'review_notes',
  提交前检查: 'preflight'
};

const FIELD_TYPES = new Set<MrTemplateFieldType>(['markdown', 'textarea', 'select', 'checkboxes']);

export function emptyMrTemplate(): MrTemplate {
  return { enabled: false, agentFill: 'allow', filename: '', sourceMd: '', fields: [] };
}

export function normalizeMrTemplate(raw: unknown): MrTemplate | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Partial<MrTemplate> & { fields?: unknown };
  const fields = normalizeFields(src.fields);
  const sourceMd = typeof src.sourceMd === 'string' ? src.sourceMd : '';
  const filename = typeof src.filename === 'string' ? src.filename.trim() : '';
  if (fields.length === 0 && !sourceMd.trim()) return null;
  const agentFill: MrTemplateAgentFill = src.agentFill === 'forbid' ? 'forbid' : 'allow';
  return {
    enabled: Boolean(src.enabled) && fields.length > 0,
    agentFill,
    filename,
    sourceMd,
    fields
  };
}

function normalizeFields(raw: unknown): MrTemplateField[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: MrTemplateField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const f = item as Partial<MrTemplateField>;
    const type = FIELD_TYPES.has(f.type as MrTemplateFieldType) ? (f.type as MrTemplateFieldType) : null;
    if (!type) continue;
    const label = typeof f.label === 'string' ? f.label.trim() : '';
    const id = uniqueId(typeof f.id === 'string' ? f.id : '', label || `field_${out.length + 1}`, used);
    const field: MrTemplateField = {
      id,
      type,
      label: label || id,
      required: type !== 'markdown' && Boolean(f.required),
      help: typeof f.help === 'string' && f.help.trim() ? f.help.trim() : undefined,
      placeholder: typeof f.placeholder === 'string' && f.placeholder.trim() ? f.placeholder.trim() : undefined
    };
    if (type === 'select') {
      field.options = uniqueStrings(f.options);
      if (field.options.length < 2) continue;
    }
    if (type === 'checkboxes') {
      field.items = normalizeItems(id, f.items);
      if (field.items.length === 0) continue;
    }
    if (type === 'markdown') {
      field.required = false;
      field.content = typeof f.content === 'string' ? f.content : '';
    }
    out.push(field);
    if (out.length >= MAX_MR_TEMPLATE_FIELDS) break;
  }
  return out;
}

function normalizeItems(parentId: string, raw: unknown): MrTemplateCheckboxItem[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: MrTemplateCheckboxItem[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const row = item as Partial<MrTemplateCheckboxItem>;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) return;
    out.push({
      id: uniqueId(typeof row.id === 'string' ? row.id : '', `${parentId}_${i + 1}`, used),
      label,
      required: Boolean(row.required)
    });
  });
  return out;
}

function uniqueStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function uniqueId(raw: string, fallback: string, used: Set<string>): string {
  const base = slugId(raw) || slugId(fallback) || 'field';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

function slugId(input: string): string {
  const trimmed = input.trim();
  if (KNOWN_IDS[trimmed]) return KNOWN_IDS[trimmed];
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (ascii) return ascii.slice(0, 40);
  return KNOWN_IDS[trimmed] ?? '';
}

export function parseMrTemplateMarkdown(markdown: string, filename = ''): MrTemplate {
  if (typeof markdown !== 'string') {
    throw new GitOperationError('请提供 Markdown 文本', 'TEMPLATE_INVALID');
  }
  if (markdown.length > MAX_MR_TEMPLATE_MD) {
    throw new GitOperationError(`模板超过 ${MAX_MR_TEMPLATE_MD} 字符上限`, 'TEMPLATE_TOO_LARGE');
  }
  const sourceMd = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const sections = splitSections(sourceMd);
  const used = new Set<string>();
  const fields: MrTemplateField[] = [];
  let index = 0;
  for (const sec of sections) {
    if (fields.length >= MAX_MR_TEMPLATE_FIELDS) break;
    if (!sec.title) {
      if (sec.body.trim()) {
        fields.push({
          id: uniqueId('', 'preamble', used),
          type: 'markdown',
          label: '说明',
          required: false,
          content: sec.body.trim()
        });
      }
      continue;
    }
    index += 1;
    fields.push(...classifySection(sec.title, sec.body, index, used));
  }
  if (fields.length === 0 && sourceMd.trim()) {
    fields.push({
      id: uniqueId('', 'body', used),
      type: 'markdown',
      label: filename || '模板',
      required: false,
      content: sourceMd.trim()
    });
  }
  return {
    enabled: fields.some((f) => f.type !== 'markdown'),
    agentFill: 'allow',
    filename: filename.trim(),
    sourceMd,
    fields: fields.slice(0, MAX_MR_TEMPLATE_FIELDS)
  };
}

function splitSections(md: string): Array<{ title: string | null; body: string }> {
  const lines = md.split('\n');
  const acc: Array<{ title: string | null; body: string[] }> = [{ title: null, body: [] }];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      acc.push({ title: m[1]!.trim(), body: [] });
    } else {
      acc[acc.length - 1]!.body.push(line);
    }
  }
  return acc
    .map((s) => ({ title: s.title, body: s.body.join('\n').replace(/^\n+|\n+$/g, '') }))
    .filter((s) => s.title || s.body.trim());
}

function sectionKey(title: string, index: number): string {
  return KNOWN_IDS[title] || slugId(title) || `section_${index}`;
}

function classifySection(title: string, body: string, index: number, used: Set<string>): MrTemplateField[] {
  const { help, rest } = extractComments(body);
  const lines = rest.split('\n');
  const fillable: string[] = [];
  const trailing: string[] = [];
  let seenFillable = false;
  let inTrailing = false;
  for (const line of lines) {
    const checkbox = isCheckboxLine(line);
    const enumLine = parseEnumLine(line);
    const placeholder = isPlaceholderLine(line);
    if (checkbox || enumLine || placeholder) {
      seenFillable = true;
      inTrailing = false;
      fillable.push(line);
      continue;
    }
    if (isStaticDecorLine(line)) {
      if (seenFillable) inTrailing = true;
      (inTrailing || !seenFillable ? trailing : fillable).push(line);
      continue;
    }
    if (!line.trim()) {
      (inTrailing ? trailing : fillable).push(line);
      continue;
    }
    if (inTrailing) trailing.push(line);
    else fillable.push(line);
  }

  const checkboxes = fillable.map(parseCheckboxLine).filter((x): x is { label: string } => Boolean(x));
  const enums = fillable.map(parseEnumLine).filter((x): x is { label: string; options: string[] } => Boolean(x));
  const hasPlaceholder = fillable.some(isPlaceholderLine);
  const prose = fillable
    .filter((l) => !isCheckboxLine(l) && !parseEnumLine(l) && !isPlaceholderLine(l) && l.trim())
    .join('\n')
    .trim();
  const trailingText = trailing.join('\n').trim();
  const onlyStatic =
    checkboxes.length === 0 && enums.length === 0 && !hasPlaceholder && !prose && !help;

  const out: MrTemplateField[] = [];
  const itemRequired = title !== '本次提交的验证方式';

  const base = sectionKey(title, index);

  if (onlyStatic) {
    out.push({
      id: uniqueId(base, `section_${index}`, used),
      type: 'markdown',
      label: title,
      required: false,
      content: body.trim()
    });
    return out;
  }

  if (hasPlaceholder || (prose && checkboxes.length === 0 && enums.length === 0) || (!prose && !checkboxes.length && !enums.length)) {
    out.push({
      id: uniqueId(base, `section_${index}`, used),
      type: 'textarea',
      label: title,
      help: help || undefined,
      required: true,
      placeholder: '（请填写）'
    });
  } else if (prose && (checkboxes.length > 0 || enums.length > 0)) {
    out.push({
      id: uniqueId(`${base}_text`, `${base}_text`, used),
      type: 'textarea',
      label: title,
      help: [help, prose].filter(Boolean).join('\n\n') || undefined,
      required: false,
      placeholder: '（请填写）'
    });
  }

  for (const en of enums) {
    const enumKey = KNOWN_IDS[title] || slugId(en.label) || `${base}_select`;
    out.push({
      id: uniqueId(enumKey, `${base}_select`, used),
      type: 'select',
      label: en.label || title,
      help: help || undefined,
      required: true,
      options: en.options
    });
  }

  if (checkboxes.length > 0) {
    const id = uniqueId(base, `${base}_checks`, used);
    out.push({
      id,
      type: 'checkboxes',
      label: title,
      help: help || undefined,
      required: false,
      items: checkboxes.map((c, i) => ({
        id: `${id}_${i + 1}`,
        label: c.label,
        required: itemRequired
      }))
    });
  }

  if (trailingText) {
    out.push({
      id: uniqueId(`${base}_note`, `${base}_note`, used),
      type: 'markdown',
      label: `${title}说明`,
      required: false,
      content: trailingText
    });
  }

  if (out.length === 0) {
    out.push({
      id: uniqueId(base, `section_${index}`, used),
      type: 'textarea',
      label: title,
      help: help || undefined,
      required: true,
      placeholder: '（请填写）'
    });
  }
  return out;
}

function extractComments(body: string): { help: string; rest: string } {
  const helps: string[] = [];
  const rest = body.replace(/<!--([\s\S]*?)-->/g, (_, c: string) => {
    const t = String(c).replace(/\s+/g, ' ').trim();
    if (t) helps.push(t);
    return '\n';
  });
  return { help: helps.join('\n'), rest: rest.replace(/\n{3,}/g, '\n\n').trim() };
}

function isCheckboxLine(line: string): boolean {
  return /^\s*[-*]\s+\[[ xX]\]\s+\S/.test(line);
}

function parseCheckboxLine(line: string): { label: string } | null {
  const m = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+?)\s*$/);
  return m ? { label: m[1]!.trim() } : null;
}

function parseEnumLine(line: string): { label: string; options: string[] } | null {
  if (isCheckboxLine(line)) return null;
  const m = line.match(/^\s*[-*]\s+(.+?)[：:]\s*(.+)$/);
  if (!m) return null;
  const options = m[2]!
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (options.length < 2) return null;
  return { label: m[1]!.trim(), options };
}

function isPlaceholderLine(line: string): boolean {
  return /^\s*[-*]\s*[（(]请填写[）)]\s*$/.test(line);
}

function isStaticDecorLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith('>')) return true;
  if (/^\|.+\|\s*$/.test(t)) return true;
  if (/^[-*]{3,}$/.test(t) || /^={3,}$/.test(t)) return true;
  return false;
}

export function renderMrTemplate(template: MrTemplate, values: MrTemplateValues = {}): string {
  const parts: string[] = [];
  for (const field of template.fields) {
    if (field.type === 'markdown') {
      const content = (field.content ?? '').trim();
      if (content) parts.push(content);
      continue;
    }
    const heading = field.label.trim() ? `## ${field.label.trim()}` : '';
    const body = renderFieldValue(field, values[field.id]);
    if (heading && body) parts.push(`${heading}\n\n${body}`);
    else if (heading) parts.push(heading);
    else if (body) parts.push(body);
  }
  return parts.join('\n\n').trim();
}

function renderFieldValue(field: MrTemplateField, raw: unknown): string {
  if (field.type === 'select') {
    const v = typeof raw === 'string' ? raw.trim() : '';
    return v ? `- ${field.label}：${v}` : `- ${field.label}：`;
  }
  if (field.type === 'checkboxes') {
    const checked = checkedSet(raw);
    return (field.items ?? [])
      .map((item) => `- [${checked.has(item.id) ? 'x' : ' '}] ${item.label}`)
      .join('\n');
  }
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text || field.placeholder || '';
}

function checkedSet(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(raw)) {
    for (const v of raw) if (typeof v === 'string' && v.trim()) out.add(v.trim());
    return out;
  }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === true || v === 'true' || v === 1) out.add(k);
    }
  }
  return out;
}

export function validateMrTemplateFields(
  template: MrTemplate,
  values: MrTemplateValues = {}
): { ok: boolean; missing: Array<{ id: string; label: string }> } {
  if (!template.enabled) return { ok: true, missing: [] };
  const missing: Array<{ id: string; label: string }> = [];
  for (const field of template.fields) {
    if (field.type === 'markdown') continue;
    const raw = values[field.id];
    if (field.type === 'select' && field.required) {
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!v || (field.options && !field.options.includes(v))) {
        missing.push({ id: field.id, label: field.label });
      }
      continue;
    }
    if (field.type === 'checkboxes') {
      const checked = checkedSet(raw);
      for (const item of field.items ?? []) {
        if (item.required && !checked.has(item.id)) {
          missing.push({ id: item.id, label: item.label });
        }
      }
      continue;
    }
    if (field.required) {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) missing.push({ id: field.id, label: field.label });
    }
  }
  return { ok: missing.length === 0, missing };
}

export function assertMrTemplateMarkdownSize(markdown: string): void {
  if (markdown.length > MAX_MR_TEMPLATE_MD) {
    throw new GitOperationError(`模板超过 ${MAX_MR_TEMPLATE_MD} 字符上限`, 'TEMPLATE_TOO_LARGE');
  }
}

export function publicMrTemplate(template: MrTemplate | null | undefined): PublicMrTemplate | null {
  if (!template) return null;
  return {
    enabled: template.enabled,
    agentFill: template.agentFill,
    fields: template.fields
  };
}

/** 启用规范时必须交 fields；成功则渲染 body，忽略传入的裸 body */
export function resolveMrCreateBody(
  template: MrTemplate | null | undefined,
  fields: unknown,
  body?: string
): string {
  if (!template?.enabled) return typeof body === 'string' ? body : '';
  if (fields == null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new GitOperationError(
      '已启用正文规范，请按 fields 填写，不要只传 body',
      'TEMPLATE_INCOMPLETE'
    );
  }
  const values = fields as MrTemplateValues;
  const check = validateMrTemplateFields(template, values);
  if (!check.ok) {
    const labels = check.missing.map((m) => m.label).join('、') || '必填字段';
    throw new GitOperationError(`正文规范未填完整：${labels}`, 'TEMPLATE_INCOMPLETE');
  }
  return renderMrTemplate(template, values);
}
