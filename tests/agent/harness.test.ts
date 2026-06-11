import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { runAgent } from '../../src/agent/runner.js';
import type { OpenAIClient } from '../../src/agent/client.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';
import {
  beginChatRun,
  endChatRun,
  enqueueSteering,
  requestCancel,
  __resetActiveRunsForTest,
} from '../../src/telegram/run-control.js';
import { QA_STATE_MARKER, replaceQaStateMessage } from '../../src/agent/qa-state.js';

const fakeSoul = 'You are a test assistant.';

function makeTool(name: string): Tool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: z.object({}),
    execute: async () => ({ ok: true, content: `${name} ok` }),
  };
}

describe('agent harness improvements', () => {
  beforeEach(() => {
    __resetActiveRunsForTest();
  });

  it('scopes tool definitions by mode', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('file_read'));
    registry.register(makeTool('qa_assert_visible'));

    const mockChat = vi.fn().mockResolvedValue({ content: 'done', model: 'gpt-test' });
    const openai: OpenAIClient = { chat: mockChat, getClient: () => ({} as never) };

    await runAgent(
      {
        soulContent: fakeSoul,
        history: [{ role: 'user', content: 'hello' }],
        primaryModel: 'gpt-test',
        fallbackModel: 'gpt-fallback',
        toolSet: 'chat',
      },
      { openai, registry }
    );

    const tools = mockChat.mock.calls[0][0].tools as Array<{ function: { name: string } }>;
    expect(tools.map((t) => t.function.name)).toEqual(['file_read']);
  });

  it('injects steering before the next model call', async () => {
    const chatId = 42;
    beginChatRun(chatId);
    enqueueSteering(chatId, 'skip login');

    const mockChat = vi.fn().mockResolvedValue({ content: 'adjusted', model: 'gpt-test' });
    const openai: OpenAIClient = { chat: mockChat, getClient: () => ({} as never) };

    await runAgent(
      {
        soulContent: fakeSoul,
        history: [{ role: 'user', content: 'run qa' }],
        primaryModel: 'gpt-test',
        fallbackModel: 'gpt-fallback',
        chatId,
      },
      { openai, registry: new ToolRegistry() }
    );

    endChatRun(chatId);
    const messages = mockChat.mock.calls[0][0].messages;
    expect(messages.some((m: { content?: string }) => m.content?.includes('[Steering] skip login'))).toBe(true);
  });

  it('cancels after the in-flight tool finishes', async () => {
    const chatId = 7;
    beginChatRun(chatId);

    const registry = new ToolRegistry();
    registry.register({
      name: 'file_read',
      description: 'read',
      inputSchema: z.object({}),
      execute: async () => {
        requestCancel(chatId);
        return { ok: true, content: 'read ok' };
      },
    });

    const mockChat = vi.fn().mockResolvedValue({
      content: 'working',
      model: 'gpt-test',
      toolCalls: [{ id: 'tc1', name: 'file_read', arguments: '{}' }],
    });
    const openai: OpenAIClient = { chat: mockChat, getClient: () => ({} as never) };

    const result = await runAgent(
      {
        soulContent: fakeSoul,
        history: [{ role: 'user', content: 'do work' }],
        primaryModel: 'gpt-test',
        fallbackModel: 'gpt-fallback',
        chatId,
        maxIterations: 3,
      },
      { openai, registry }
    );

    endChatRun(chatId);
    expect(result.cancelled).toBe(true);
    expect(result.content).toContain('stopped');
  });

  it('replaces prior QA state snapshots instead of accumulating them', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: `${QA_STATE_MARKER}\nold` },
    ];
    const replaced = replaceQaStateMessage(messages, `${QA_STATE_MARKER}\nnew`);
    const qaStates = replaced.filter((m) => m.role === 'user' && String(m.content).startsWith(QA_STATE_MARKER));
    expect(qaStates).toHaveLength(1);
    expect(qaStates[0].content).toContain('new');
  });
});