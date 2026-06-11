import { describe, it, expect } from 'vitest';
import { CHAT_TOOL_NAMES, isToolInSet } from '../../src/agent/tool-sets.js';

describe('agent tool sets', () => {
  it('chat set excludes QA-only tools', () => {
    expect(CHAT_TOOL_NAMES.has('file_read')).toBe(true);
    expect(CHAT_TOOL_NAMES.has('browser_navigate')).toBe(true);
    expect(CHAT_TOOL_NAMES.has('browser_wait_for')).toBe(false);
    expect(CHAT_TOOL_NAMES.has('qa_assert_visible')).toBe(false);
    expect(CHAT_TOOL_NAMES.has('qa_accessibility_audit')).toBe(false);
  });

  it('qa and all sets include every tool name', () => {
    expect(isToolInSet('qa_assert_visible', 'qa')).toBe(true);
    expect(isToolInSet('browser_wait_for', 'qa')).toBe(true);
    expect(isToolInSet('qa_assert_visible', 'all')).toBe(true);
    expect(isToolInSet('browser_wait_for', 'chat')).toBe(false);
  });
});