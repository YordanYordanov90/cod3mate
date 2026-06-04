/**
 * Credential and secret sanitization.
 *
 * This module provides functions to redact sensitive values from strings
 * before they are:
 *   - logged
 *   - sent to the model (as tool observations)
 *   - included in Telegram responses
 *   - stored in sessions
 *
 * Central redaction is required by architecture invariants.
 */

export interface SanitizeOptions {
  /** Custom values to redact (in addition to auto-detected patterns) */
  extraSecrets?: string[];
}

/**
 * Module-level registry of literal secret values that must always be redacted
 * from sanitized output. Populated at startup with values like
 * TEST_ACCOUNT_* (legacy) and TEST_CREDENTIALS_<APP>_* (Phase 8) so every downstream sanitize call
 * — tool results, chat replies, task summaries — automatically scrubs them.
 *
 * Centralizing here satisfies architecture invariant #2 (zero secret leakage)
 * without plumbing extraSecrets through every call site.
 */
const registeredSecrets = new Set<string>();

/**
 * Register a literal secret value for global redaction.
 * Values shorter than 4 chars are ignored (would be too risky to regex-replace).
 */
export function registerSecret(value: string | undefined | null): void {
  if (!value || typeof value !== 'string') return;
  if (value.length < 4) return;
  registeredSecrets.add(value);
}

/**
 * Snapshot of currently registered secrets. Exposed for tests / diagnostics.
 */
export function getRegisteredSecrets(): string[] {
  return Array.from(registeredSecrets);
}

/**
 * Clear all globally registered secrets. Test-only utility.
 */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/**
 * Redact a single string value.
 * Replaces known secrets and common credential patterns with [REDACTED].
 */
export function sanitizeString(input: string, options: SanitizeOptions = {}): string {
  if (!input || typeof input !== 'string') return input;

  let result = input;

  // Combine caller-supplied secrets with the global registry.
  const secrets = [...(options.extraSecrets ?? []), ...registeredSecrets];
  for (const secret of secrets) {
    if (secret && secret.length > 3) {
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      result = result.replace(regex, '[REDACTED]');
    }
  }

  // Common credential patterns (OpenAI, Telegram, Tavily, generic keys)
  const patterns: RegExp[] = [
    // OpenAI keys: sk-... (catch even short ones in tests)
    /\bsk-[A-Za-z0-9_-]{10,}\b/g,
    // Telegram bot tokens
    /\b[0-9]{8,}:[A-Za-z0-9_-]{20,}\b/g,
    // Tavily keys
    /\btvly-[A-Za-z0-9_-]{10,}\b/g,
    // Generic long tokens / keys
    /\b[A-Za-z0-9_-]{24,}\b/g,
    // Bearer tokens
    /\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi,
  ];

  for (const pattern of patterns) {
    result = result.replace(pattern, '[REDACTED]');
  }

  return result;
}

/**
 * Sanitize an object (deep, best-effort).
 * Useful for tool metadata or complex observations.
 */
export function sanitizeObject<T>(obj: T, options: SanitizeOptions = {}): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return sanitizeString(obj, options) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, options)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Never include raw secret-like keys
      if (/key|token|secret|password|api[_-]?key/i.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeObject(value, options);
      }
    }
    return sanitized as T;
  }

  return obj;
}

/**
 * Sanitize a ToolResult before it is shown to the agent / model.
 */
export function sanitizeToolResult(
  result: import('../tools/types.js').ToolResult,
  options: SanitizeOptions = {}
): import('../tools/types.js').ToolResult {
  if (result.ok) {
    const out: any = {
      ok: true,
      content: sanitizeString(result.content, options),
    };
    if (result.metadata) out.metadata = sanitizeObject(result.metadata, options);
    return out;
  }

  const out: any = {
    ok: false,
    error: sanitizeString(result.error, options),
  };
  if (result.metadata) out.metadata = sanitizeObject(result.metadata, options);
  return out;
}