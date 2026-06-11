/**
 * Per-chat run control for mid-run steering and cancellation (Roadmap v2 Phase 3).
 */

interface ChatRunState {
  steeringQueue: string[];
  cancelRequested: boolean;
}

const activeRuns = new Map<number, ChatRunState>();

function getOrCreate(chatId: number): ChatRunState {
  let state = activeRuns.get(chatId);
  if (!state) {
    state = { steeringQueue: [], cancelRequested: false };
    activeRuns.set(chatId, state);
  }
  return state;
}

export function beginChatRun(chatId: number): void {
  activeRuns.set(chatId, { steeringQueue: [], cancelRequested: false });
}

export function endChatRun(chatId: number): void {
  activeRuns.delete(chatId);
}

export function isChatRunActive(chatId: number): boolean {
  return activeRuns.has(chatId);
}

export function enqueueSteering(chatId: number, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  getOrCreate(chatId).steeringQueue.push(trimmed);
}

export function drainSteering(chatId: number): string[] {
  const state = activeRuns.get(chatId);
  if (!state || state.steeringQueue.length === 0) return [];
  const drained = [...state.steeringQueue];
  state.steeringQueue = [];
  return drained;
}

export function requestCancel(chatId: number): void {
  getOrCreate(chatId).cancelRequested = true;
}

export function shouldCancelRun(chatId: number): boolean {
  return activeRuns.get(chatId)?.cancelRequested ?? false;
}

/** Test helper — clear all active runs. */
export function __resetActiveRunsForTest(): void {
  activeRuns.clear();
}