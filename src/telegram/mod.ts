/**
 * Telegram module public API.
 * Milestone 2: bot creation, whitelist, and command shells.
 */

export { createBot, startBot, type Cod3mateBot, type BotDependencies } from './bot.js';
export { chunkMessage, sendChunked, type ChunkOptions } from './format.js';

// Re-export session types used by bot for convenience
export type { ChatSession, SessionMessage } from '../storage/sessions.js';