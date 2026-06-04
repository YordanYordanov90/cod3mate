import path from 'node:path';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { readJsonFile, writeJsonFile, getStoragePaths } from './mod.js';

export interface QaScenario {
  name: string;
  description?: string | undefined;
  baseUrl?: string | undefined;
  steps: Array<{
    action: string;
    url?: string | undefined;
    selector?: string | undefined;
    text?: string | undefined;
    value?: string | undefined;
    pattern?: string | undefined;
    mode?: 'exact' | 'contains' | 'regex' | undefined;
    expected?: number | undefined;
    state?: 'visible' | 'hidden' | 'attached' | 'detached' | undefined;
    timeoutMs?: number | undefined;
    name?: string | undefined; // label for assertions in report
  }>;
}

export interface StoredQaScenario extends QaScenario {
  savedAt: string;
}

/**
 * Ensure the qa-scenarios dir exists (idempotent). Returns the full path.
 */
export async function ensureQaScenariosDir(dataDir: string): Promise<string> {
  const paths = getStoragePaths(dataDir);
  await mkdir(paths.qaScenariosDir, { recursive: true });
  return paths.qaScenariosDir;
}

/**
 * Save (or overwrite) a scenario as JSON under /data/qa-scenarios/<sanitized-name>.json
 * Stores with savedAt timestamp.
 */
export async function saveQaScenario(dataDir: string, scenario: QaScenario): Promise<string> {
  const dir = await ensureQaScenariosDir(dataDir);
  const safeName = (scenario.name || 'unnamed')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'scenario';
  const filePath = path.join(dir, `${safeName}.json`);
  const toStore: StoredQaScenario = {
    ...scenario,
    name: safeName, // normalize name
    savedAt: new Date().toISOString(),
  };
  await writeJsonFile(filePath, toStore);
  return safeName;
}

/**
 * Load a scenario by (sanitized) name. Returns null if not found.
 */
export async function loadQaScenario(dataDir: string, name: string): Promise<QaScenario | null> {
  const dir = await ensureQaScenariosDir(dataDir);
  const safeName = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!safeName) return null;
  const filePath = path.join(dir, `${safeName}.json`);
  const data = await readJsonFile<StoredQaScenario>(filePath);
  if (!data || !Array.isArray(data.steps)) return null;
  // Return without the savedAt wrapper for clean use
  const { savedAt, ...scenario } = data;
  return scenario as QaScenario;
}

/**
 * List saved scenarios (lightweight summaries for /qa-scenarios command).
 */
export async function listQaScenarios(
  dataDir: string,
  limit = 20
): Promise<
  Array<{
    name: string;
    description?: string | undefined;
    stepCount: number;
    baseUrl?: string | undefined;
    savedAt?: string | undefined;
  }>
> {
  const dir = await ensureQaScenariosDir(dataDir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const candidates: Array<{ name: string; mtime: number; data: StoredQaScenario }> = [];

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    try {
      const st = await stat(full);
      const data = await readJsonFile<StoredQaScenario>(full);
      if (data && typeof data.name === 'string' && Array.isArray(data.steps)) {
        candidates.push({
          name: data.name,
          mtime: st.mtimeMs,
          data,
        });
      }
    } catch {
      // ignore corrupt
    }
  }

  candidates.sort((a, b) => {
    const ta = Date.parse(a.data.savedAt || '') || a.mtime;
    const tb = Date.parse(b.data.savedAt || '') || b.mtime;
    return tb - ta;
  });

  return candidates.slice(0, limit).map((c) => ({
    name: c.data.name,
    description: c.data.description ?? undefined,
    stepCount: c.data.steps?.length || 0,
    baseUrl: c.data.baseUrl ?? undefined,
    savedAt: c.data.savedAt ?? undefined,
  }));
}
