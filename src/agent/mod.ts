/**
 * Agent module — OpenAI integration, prompt construction, and agent loop.
 * Milestone 4: basic loop without tools.
 */

export {
  createOpenAIClient,
  isRetryableForFallback,
  type OpenAIClient,
  type ChatRequest,
  type ChatResponse,
  type ToolCall,
} from './client.js';
export { buildSystemPrompt, type PromptContext } from './prompt.js';
export { runAgent, type AgentInput, type AgentResult, type AgentDependencies } from './runner.js';