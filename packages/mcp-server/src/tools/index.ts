/**
 * 工具注册表：定义在 core/capabilities/git/*.ts。
 * 加载本模块时写入 Capability registry。新工具禁止只写在本包。
 */
import { getCapabilityRegistry, TOOL_DEFS, TOOL_DEF_MAP, toolSummaries } from '@shaohui_jin/git-cockpit-core';
import type { GitService } from '@shaohui_jin/git-cockpit-core';

getCapabilityRegistry().registerAll(TOOL_DEFS);

export { TOOL_DEFS, TOOL_DEF_MAP, toolSummaries };
export type { GitService };
