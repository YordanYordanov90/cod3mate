import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginChatRun,
  endChatRun,
  enqueueSteering,
  drainSteering,
  isChatRunActive,
  requestCancel,
  shouldCancelRun,
  __resetActiveRunsForTest,
} from '../../src/telegram/run-control.js';

describe('telegram run control', () => {
  const chatId = 99;

  beforeEach(() => {
    __resetActiveRunsForTest();
  });

  it('tracks active runs and steering queue', () => {
    beginChatRun(chatId);
    expect(isChatRunActive(chatId)).toBe(true);

    enqueueSteering(chatId, 'check dashboard instead');
    expect(drainSteering(chatId)).toEqual(['check dashboard instead']);
    expect(drainSteering(chatId)).toEqual([]);

    endChatRun(chatId);
    expect(isChatRunActive(chatId)).toBe(false);
  });

  it('supports cancel requests', () => {
    beginChatRun(chatId);
    requestCancel(chatId);
    expect(shouldCancelRun(chatId)).toBe(true);
  });
});