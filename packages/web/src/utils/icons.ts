/* ==========================================================================
   Git Cockpit · 图标系统（2026-10 视觉改版）
   24 网格 / stroke 1.5 / round cap+join / 2px 安全边距 / 几何优先
   全部为自绘内联 SVG 路径数据：无第三方图标库、无 emoji。
   用法：<GcIcon name="branch" /> 或 iconSvg('branch') 取 SVG 字符串。
   规格源：docs/visual-refresh/assets/icons.js（47 键全集移植）
   ========================================================================== */

/** 图标路径表：key → SVG 内部元素（circle/path/rect，配合外层 svg 骨架） */
const PATHS: Record<string, string> = {
  /* 品牌符号：四 loop 闭合几何（仪表旋钮组） */
  logo:
    '<circle cx="5.5" cy="5.5" r="3.4" stroke-width="2"/>' +
    '<circle cx="18.5" cy="5.5" r="3.4" stroke-width="2"/>' +
    '<circle cx="5.5" cy="18.5" r="3.4" stroke-width="2"/>' +
    '<circle cx="18.5" cy="18.5" r="3.4" stroke-width="2"/>' +
    '<path d="M8.9 5.5h6.2M8.9 18.5h6.2M5.5 8.9v6.2M18.5 8.9v6.2" stroke-width="2"/>',

  /* dock 7 页 */
  gauge:
    '<path d="M3.5 17.5a8.5 8.5 0 1 1 17 0"/>' +
    '<path d="M12 17.5 16.4 11"/>' +
    '<circle cx="12" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
  activity: '<path d="M3 12h3.8l2.4-6.2 4.2 12.4 2.4-6.2H21"/>',
  'git-merge':
    '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="12" r="2"/>' +
    '<path d="M7 8v8"/><path d="M9 8.4A6 6 0 0 0 15 12"/>',
  layers: '<path d="M12 3.2 3.2 8 12 12.8 20.8 8 12 3.2Z"/><path d="m3.2 12.6 8.8 4.8 8.8-4.8"/>',
  scroll:
    '<path d="M6.2 4h10.6a1.8 1.8 0 0 1 1.8 1.8V18a2 2 0 0 0 2 2H8a1.8 1.8 0 0 1-1.8-1.8V4Z"/>' +
    '<path d="M6.2 4A1.8 1.8 0 0 0 4.4 5.8v.9h1.8"/>' +
    '<path d="M9 9h7M9 12.6h7M9 16.2h4"/>',
  bubble:
    '<path d="M4 6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v7.2a2.4 2.4 0 0 1-2.4 2.4h-5.4L8 19.6V16H6.4A2.4 2.4 0 0 1 4 13.6V6.4Z"/>',
  sliders:
    '<path d="M4 7.5h8.4M17.6 7.5H20M4 16.5h3.4M12.6 16.5H20"/>' +
    '<circle cx="15" cy="7.5" r="2.1"/><circle cx="10" cy="16.5" r="2.1"/>',

  /* 通用 */
  branch:
    '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="8" r="2"/>' +
    '<path d="M7 8v8"/><path d="M17 10v1.6a4 4 0 0 1-4 4H9"/>',
  commit: '<circle cx="12" cy="12" r="3.2"/><path d="M3.2 12h5.6M15.2 12h5.6"/>',
  conflict:
    '<path d="M12 3.4 2.8 19.8h18.4L12 3.4Z"/><path d="M12 9.4v4.6"/>' +
    '<circle cx="12" cy="17" r=".95" fill="currentColor" stroke="none"/>',
  remote:
    '<circle cx="12" cy="5.2" r="2"/><circle cx="6" cy="18.8" r="2"/><circle cx="18" cy="18.8" r="2"/>' +
    '<path d="M12 7.2v4.4M6 16.8v-2.6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2.6"/>',
  repo: '<path d="M5.4 4.4h11.2a1.8 1.8 0 0 1 1.8 1.8V20H7.2a1.8 1.8 0 0 1-1.8-1.8V4.4Z"/>' + '<path d="M5.4 18h13"/>',
  'dry-run':
    '<path d="M12 3.2 5.2 6v5.8c0 4 2.9 7.2 6.8 9 3.9-1.8 6.8-5 6.8-9V6L12 3.2Z"/>' +
    '<circle cx="12" cy="11.4" r="2.1"/>' +
    '<path d="M8.6 11.4c1-1.7 2.1-2.6 3.4-2.6s2.4.9 3.4 2.6c-1 1.7-2.1 2.6-3.4 2.6s-2.4-.9-3.4-2.6Z"/>',
  abort: '<circle cx="12" cy="12" r="8.2"/><path d="m6.2 6.2 11.6 11.6"/>',
  check: '<path d="m5.2 12.6 4.6 4.6L19 6.8"/>',
  chevron: '<path d="m9.4 6.2 5.8 5.8-5.8 5.8"/>',
  'chevron-left': '<path d="m14.6 6.2-5.8 5.8 5.8 5.8"/>',
  'chevron-down': '<path d="m6.2 9.4 5.8 5.8 5.8-5.8"/>',
  search: '<circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 4.4 4.4"/>',
  copy: '<rect x="9" y="9" width="10.6" height="10.6" rx="2"/>' + '<path d="M5.4 15.2V6.4a1.6 1.6 0 0 1 1.6-1.6h8.8"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.4v5h-5"/>',
  close: '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/>',
  more:
    '<circle cx="5.6" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="18.4" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  'arrow-up': '<path d="M12 19V5.4M6.4 11 12 5.4 17.6 11"/>',
  'arrow-down': '<path d="M12 5v13.6M6.4 13 12 18.6 17.6 13"/>',
  play: '<path d="M8.2 5.4v13.2L18.4 12 8.2 5.4Z"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12.4l3.2 2"/>',
  agent:
    '<rect x="4.8" y="7.8" width="14.4" height="11.4" rx="3.2"/><path d="M12 4v3.8"/>' +
    '<circle cx="12" cy="3" r="1.1" fill="currentColor" stroke="none"/>' +
    '<circle cx="9.4" cy="12.6" r="1.05" fill="currentColor" stroke="none"/>' +
    '<circle cx="14.6" cy="12.6" r="1.05" fill="currentColor" stroke="none"/>' +
    '<path d="M9.4 15.8h5.2"/>',
  send: '<path d="M4 12 20.4 4l-6.2 16.2-3.1-7.1L4 12Z"/><path d="m11.1 13.1 4.2-4.2"/>',
  filter: '<path d="M4 5.2h16l-6.2 7.2V19l-3.6 1.8v-8.4L4 5.2Z"/>',
  external:
    '<path d="M14 4.2h5.8V10"/><path d="M19.8 4.2 11.6 12.4"/>' +
    '<path d="M18 14v5.4a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19.4V8.2a1.4 1.4 0 0 1 1.4-1.4H11"/>',
  file: '<path d="M6.4 3.6h7l4.6 4.6V20H6.4V3.6Z"/><path d="M13.4 3.6v4.6h4.6"/>',
  key: '<circle cx="8.2" cy="12" r="4"/><path d="M12.2 12H20"/><path d="M18 12v3M15.4 12v2"/>',
  lock: '<rect x="5.2" y="10.4" width="13.6" height="9.4" rx="2"/>' + '<path d="M8.2 10.4V7.4a3.8 3.8 0 0 1 7.6 0v3"/>',
  cpu:
    '<rect x="7.4" y="7.4" width="9.2" height="9.2" rx="2"/>' +
    '<path d="M10 3.6v3.8M14 3.6v3.8M10 16.6v3.8M14 16.6v3.8M3.6 10h3.8M3.6 14h3.8M16.6 10h3.8M16.6 14h3.8"/>',
  list: '<path d="M4.4 6.4h15.2M4.4 12h15.2M4.4 17.6h9.6"/>',
  terminal:
    '<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2"/>' + '<path d="m7.4 9.4 2.8 2.6-2.8 2.6M13 14.6h3.8"/>',
  push: '<path d="M12 16.4V4.4M7.2 9.2 12 4.4l4.8 4.8"/><path d="M4.4 19.6h15.2"/>',
  pull: '<path d="M12 4.4v12M7.2 11.6 12 16.4l4.8-4.8"/><path d="M4.4 19.6h15.2"/>',
  diff: '<path d="M7 4.4v15.2M17 4.4v15.2"/><path d="M4.4 9h5.2M14.4 15h5.2"/>',
  shield: '<path d="M12 3.2 5.2 6v5.8c0 4 2.9 7.2 6.8 9 3.9-1.8 6.8-5 6.8-9V6L12 3.2Z"/>',
  eye: '<circle cx="12" cy="12" r="2.4"/><path d="M3.6 12S6.8 6.4 12 6.4 20.4 12 20.4 12 17.2 17.6 12 17.6 3.6 12 3.6 12Z"/>',
  calendar: '<rect x="4" y="5.6" width="16" height="14.4" rx="2"/><path d="M4 10.4h16M8.4 3.6v4M15.6 3.6v4"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  minus: '<path d="M5.2 12h13.6"/>',
  info:
    '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5.2"/>' +
    '<circle cx="12" cy="7.9" r=".95" fill="currentColor" stroke="none"/>',
  alert:
    '<path d="M12 3.4 2.8 19.8h18.4L12 3.4Z"/><path d="M12 9.4v4.6"/>' +
    '<circle cx="12" cy="17" r=".95" fill="currentColor" stroke="none"/>'
};

/** 生成完整 SVG 字符串（currentColor 描边，继承文字色） */
export function iconSvg(name: string): string {
  const body = PATHS[name];
  if (!body) return '';
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    body +
    '</svg>'
  );
}

/** 已注册图标名清单（供自检/文档使用） */
export const ICON_NAMES = Object.keys(PATHS);
