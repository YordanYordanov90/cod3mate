/**
 * Telegram message formatting and chunking utilities.
 *
 * These are pure functions with no GrammY or agent coupling.
 * Used by command handlers and (later) the agent response path.
 */

export interface ChunkOptions {
  maxChunkSize?: number;
}

/**
 * Split a message into chunks that respect Telegram's practical length limit.
 * Prefers paragraph (\n\n), then line, then sentence boundaries.
 * Falls back to hard cut only when necessary.
 *
 * Default maxChunkSize comes from TELEGRAM_CHUNK_SIZE (3500) at call site.
 */
export function chunkMessage(text: string, options: ChunkOptions = {}): string[] {
  const maxSize = options.maxChunkSize ?? 3500;

  if (!text || text.length === 0) {
    return [];
  }

  if (text.length <= maxSize) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxSize) {
      chunks.push(remaining);
      break;
    }

    let cut = findBestCut(remaining, maxSize);

    // Guard against zero-progress splits
    if (cut <= 0 || cut > maxSize) {
      cut = maxSize;
    }

    const chunk = remaining.slice(0, cut).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    remaining = remaining.slice(cut).trim();
  }

  return chunks.length > 0 ? chunks : [text.slice(0, maxSize)];
}

function findBestCut(text: string, maxSize: number): number {
  const search = text.slice(0, maxSize);

  // 1. Paragraph break (best)
  const para = search.lastIndexOf('\n\n');
  if (para > 80) return para + 2;

  // 2. Single newline
  const line = search.lastIndexOf('\n');
  if (line > 80) return line + 1;

  // 3. Sentence end (". " or similar)
  const sentence = Math.max(
    search.lastIndexOf('. '),
    search.lastIndexOf('! '),
    search.lastIndexOf('? ')
  );
  if (sentence > 80) return sentence + 2;

  // 4. Space (word boundary)
  const space = search.lastIndexOf(' ');
  if (space > 80) return space + 1;

  // Hard cut as last resort
  return maxSize;
}

/**
 * Convenience helper for sending chunked plain-text replies.
 * Used by Telegram command handlers.
 */
export async function sendChunked(
  sendFn: (text: string) => Promise<unknown>,
  text: string,
  options: ChunkOptions = {}
): Promise<void> {
  const chunks = chunkMessage(text, options);
  for (const chunk of chunks) {
    await sendFn(chunk);
  }
}