import path from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';

export const QA_ARTIFACTS_DIR = 'qa-artifacts';
export const QA_SCREENSHOTS_SUBDIR = 'screenshots';

const ALLOWED_SCREENSHOT_EXT = /\.(png|jpe?g)$/i;

export interface QaArtifactPaths {
  artifactsRoot: string;
  screenshotsRoot: string;
}

export interface DurableScreenshotMeta {
  filename: string;
  /** Path relative to `/data/qa-artifacts/screenshots/` (e.g. `<reportId>/step.png`). */
  path: string;
  label?: string;
}

export function getQaArtifactPaths(dataDir: string): QaArtifactPaths {
  const resolvedData = path.resolve(dataDir);
  const artifactsRoot = path.join(resolvedData, QA_ARTIFACTS_DIR);
  return {
    artifactsRoot,
    screenshotsRoot: path.join(artifactsRoot, QA_SCREENSHOTS_SUBDIR),
  };
}

export function sanitizeReportId(reportId: string): string {
  const safe = reportId.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('Invalid report id');
  }
  return safe;
}

/** Basename-only screenshot filename with a supported image extension. */
export function sanitizeScreenshotFilename(filename: string): string {
  const base = path.basename(filename.replace(/\\/g, '/'));
  let safeName = (base.trim() || `screenshot-${Date.now()}.png`).replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (!ALLOWED_SCREENSHOT_EXT.test(safeName)) {
    safeName += '.png';
  }
  return safeName;
}

export function isAllowedScreenshotFilename(filename: string): boolean {
  return ALLOWED_SCREENSHOT_EXT.test(filename);
}

/**
 * Resolve a path inside an artifact root using the same containment pattern as file tools.
 */
export function resolveSafeArtifactPath(userPath: string, root: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, userPath);

  if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
    throw new Error('Path traversal detected');
  }

  return resolvedTarget;
}

export function resolveDurableScreenshotPath(
  dataDir: string,
  reportId: string,
  filename: string
): { reportDir: string; fullPath: string; relativePath: string; filename: string } {
  const safeId = sanitizeReportId(reportId);
  const safeName = sanitizeScreenshotFilename(filename);
  if (!isAllowedScreenshotFilename(safeName)) {
    throw new Error('Unsupported screenshot extension');
  }

  const { screenshotsRoot } = getQaArtifactPaths(dataDir);
  const reportDir = path.join(screenshotsRoot, safeId);
  const fullPath = resolveSafeArtifactPath(safeName, reportDir);
  const relativePath = `${safeId}/${safeName}`;

  return { reportDir, fullPath, relativePath, filename: safeName };
}

export async function ensureQaArtifactsDirs(dataDir: string): Promise<QaArtifactPaths> {
  const paths = getQaArtifactPaths(dataDir);
  await mkdir(paths.artifactsRoot, { recursive: true });
  await mkdir(paths.screenshotsRoot, { recursive: true });
  return paths;
}

function resolveTmpScreenshotPath(tmpDir: string, tmpRelativePath: string): string | null {
  const root = path.resolve(tmpDir);
  const safeRel = tmpRelativePath.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  const full = path.resolve(root, safeRel);
  if (full !== root && !full.startsWith(root + path.sep)) {
    return null;
  }
  return full;
}

/**
 * Copy a transient TMP_DIR screenshot into a report-scoped durable folder.
 * Returns metadata for persistence on the saved QA report JSON.
 */
export async function copyTmpScreenshotToDurable(
  dataDir: string,
  tmpDir: string,
  reportId: string,
  tmpRelativePath: string
): Promise<DurableScreenshotMeta | null> {
  const tmpFull = resolveTmpScreenshotPath(tmpDir, tmpRelativePath);
  if (!tmpFull) {
    return null;
  }

  const basename = path.basename(tmpRelativePath.replace(/\\/g, '/'));
  const { reportDir, fullPath, relativePath, filename } = resolveDurableScreenshotPath(
    dataDir,
    reportId,
    basename
  );

  try {
    await mkdir(reportDir, { recursive: true });
    await copyFile(tmpFull, fullPath);
  } catch {
    return null;
  }

  const normalizedRel = tmpRelativePath.replace(/\\/g, '/');
  const meta: DurableScreenshotMeta = {
    filename,
    path: relativePath,
    label: normalizedRel,
  };

  return meta;
}
