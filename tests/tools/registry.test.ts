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
});