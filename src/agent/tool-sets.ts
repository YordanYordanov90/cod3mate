/**
 * Mode-scoped tool exposure (QA Roadmap v2 Phase 2).
 * Chat mode gets core tools; QA mode exposes the full registered set.
 */

export type AgentToolSet = 'chat' | 'qa' | 'all';

/** Core tools available during normal chat. */
export const CHAT_TOOL_NAMES = new Set([
  'file_read',
  'file_write',
  'terminal_exec',
  'web_search',
  'browser_navigate',
  'browser_click',
  'browser_fill',
  'browser_screenshot',
  'browser_extract_text',
  'browser_inspect_form',
  'browser_reset',
]);

export function resolveToolSet(
  toolSet: AgentToolSet | undefined,
  exposeAllTools: boolean
): AgentToolSet {
  if (exposeAllTools) return 'all';
  return toolSet ?? 'chat';
}

export function isToolInSet(name: string, set: AgentToolSet): boolean {
  if (set === 'all' || set === 'qa') return true;
  return CHAT_TOOL_NAMES.has(name);
}