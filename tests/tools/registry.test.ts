import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

const echoTool: Tool<{ message: string }> = {
  name: 'echo',
  description: 'Echoes back the message',
  inputSchema: z.object({ message: z.string() }),
  execute: async ({ message }) => ({
    ok: true,
    content: `Echo: ${message}`,
  }),
};

describe('Tool Registry (M5)', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves tools', () => {
    registry.register(echoTool);
    expect(registry.get('echo')).toBeDefined();
    expect(registry.listNames()).toContain('echo');
  });

  it('rejects duplicate registration', () => {
    registry.register(echoTool);
    expect(() => registry.register(echoTool)).toThrow(/already registered/);
  });

  it('returns unknown tool error for missing tools', async () => {
    const result = await registry.execute('nonexistent', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('validates input with Zod before execution', async () => {
    registry.register(echoTool);
    const result = await registry.execute('echo', { message: 123 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('executes valid tool and returns normalized result', async () => {
    registry.register(echoTool);
    const result = await registry.execute('echo', { message: 'hello' });
    expect(result.ok).toBe(true);
    expect(result.content).toBe('Echo: hello');
  });

  it('provides OpenAI-compatible tool definitions', () => {
    registry.register(echoTool);
    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('echo');
    expect(defs[0].parameters.type).toBe('object');
  });

  it('filters tool definitions by mode', () => {
    registry.register({
      name: 'file_read',
      description: 'read',
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({ ok: true, content: 'ok' }),
    });
    registry.register({
      name: 'qa_assert_visible',
      description: 'assert',
      inputSchema: z.object({ selector: z.string() }),
      execute: async () => ({ ok: true, content: 'pass' }),
    });

    const chatDefs = registry.getToolDefinitionsForSet('chat');
    const qaDefs = registry.getToolDefinitionsForSet('qa');

    expect(chatDefs.map((d) => d.name)).toEqual(['file_read']);
    expect(qaDefs.map((d) => d.name)).toEqual(['file_read', 'qa_assert_visible']);
    expect(registry.getToolDefinitionsForSet('chat', true).map((d) => d.name)).toEqual([
      'file_read',
      'qa_assert_visible',
    ]);
  });
});