import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * Thin, typed wrapper around the official OpenAI SDK.
 * Provides a simple interface for chat completions with clear error handling.
 */

export interface OpenAIClientConfig {
  apiKey: string;
  baseURL?: string;
}

export interface ChatRequest {
  messages: ChatCompletionMessageParam[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Tool definitions for this call (OpenAI tools format) */
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string as returned by OpenAI
}

export interface ChatResponse {
  content: string;
  model: string;
  finishReason?: string | null | undefined;
  /** Present when the model wants to call tools */
  toolCalls?: ToolCall[];
}

export type OpenAIClient = {
  chat: (req: ChatRequest) => Promise<ChatResponse>;
  getClient: () => OpenAI; // escape hatch if needed later
};

/**
 * Create a wrapped OpenAI client.
 */
export function createOpenAIClient(config: OpenAIClientConfig): OpenAIClient {
  const openai = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  async function chat(req: ChatRequest): Promise<ChatResponse> {
    const completion = await openai.chat.completions.create({
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? null,
      ...(req.tools && req.tools.length > 0 ? { tools: req.tools } : {}),
    });

    const choice = completion.choices[0];
    const message = choice?.message;
    const content = message?.content?.trim() ?? '';

    // Extract tool calls if present
    const toolCalls: ToolCall[] | undefined = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    const response: any = {
      content,
      model: completion.model,
      finishReason: choice?.finish_reason ?? undefined,
    };
    if (toolCalls && toolCalls.length > 0) response.toolCalls = toolCalls;
    return response;
  }

  return {
    chat,
    getClient: () => openai,
  };
}

/**
 * Error classification for fallback decisions.
 */
export function isRetryableForFallback(error: unknown): boolean {
  if (!error) return false;

  const err = error as any;

  // OpenAI SDK error types
  if (err.status) {
    // Rate limits, server errors, timeouts — worth trying fallback
    if (err.status === 429 || err.status >= 500) return true;
    // Auth errors are not retryable with fallback
    if (err.status === 401 || err.status === 403) return false;
  }

  const message = String(err.message || err).toLowerCase();
  if (message.includes('rate limit') || message.includes('timeout') || message.includes('503')) {
    return true;
  }

  return false;
}