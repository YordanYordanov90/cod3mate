import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { getQaArtifactPaths } from './qa-artifacts.js';

/**
 * Storage helpers for /data (Railway volume) and /tmp.
 * All paths are resolved relative to the configured DATA_DIR.
 */

export const SESSIONS_DIR = 'sessions';
export const SOUL_FILE = 'SOUL.md';
export const QA_REPORTS_DIR = 'qa-reports';
export const QA_TRANSCRIPTS_DIR = 'qa-transcripts';
export const QA_SCENARIOS_DIR = 'qa-scenarios';
export { QA_ARTIFACTS_DIR, QA_SCREENSHOTS_SUBDIR } from './qa-artifacts.js';

export interface StoragePaths {
  dataDir: string;
  sessionsDir: string;
  soulPath: string;
  qaReportsDir: string;
  qaTranscriptsDir: string;
  qaScenariosDir: string;
  qaArtifactsDir: string;
  qaScreenshotsDir: string;
}

/**
 * Resolve and return the canonical storage paths.
 */
export function getStoragePaths(dataDir: string): StoragePaths {
  const resolvedData = path.resolve(dataDir);
  const artifactPaths = getQaArtifactPaths(resolvedData);
  return {
    dataDir: resolvedData,
    sessionsDir: path.join(resolvedData, SESSIONS_DIR),
    soulPath: path.join(resolvedData, SOUL_FILE),
    qaReportsDir: path.join(resolvedData, QA_REPORTS_DIR),
    qaTranscriptsDir: path.join(resolvedData, QA_TRANSCRIPTS_DIR),
    qaScenariosDir: path.join(resolvedData, QA_SCENARIOS_DIR),
    qaArtifactsDir: artifactPaths.artifactsRoot,
    qaScreenshotsDir: artifactPaths.screenshotsRoot,
  };
}

/**
 * Ensure the data directory and sessions subdirectory exist.
 * Safe to call multiple times (idempotent).
 */
export async function ensureDataDirectories(dataDir: string): Promise<void> {
  const paths = getStoragePaths(dataDir);

  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.sessionsDir, { recursive: true });
  await mkdir(paths.qaReportsDir, { recursive: true });
  await mkdir(paths.qaTranscriptsDir, { recursive: true });
  await mkdir(paths.qaScenariosDir, { recursive: true });
  await mkdir(paths.qaArtifactsDir, { recursive: true });
  await mkdir(paths.qaScreenshotsDir, { recursive: true });
}

/**
 * Check if a file exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a text file. Returns null if not found (ENOENT).
 * Throws on other errors.
 */
export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write text content to a file (overwrites).
 */
export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, 'utf8');
}

/**
 * Read and parse a JSON file. Returns null if not found.
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  const text = await readTextFile(filePath);
  if (text === null) return null;
  return JSON.parse(text) as T;
}

/**
 * Write data as pretty JSON.
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  await writeTextFile(filePath, text);
}

// Re-export session functionality
export type { ChatSession, SessionMessage } from './sessions.js';
export {
  loadSession,
  saveSession,
  resetSession,
  appendMessage,
  setSelectedModel,
  createEmptySession,
} from './sessions.js';