import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  copyTmpScreenshotToDurable,
  getQaArtifactPaths,
  isAllowedScreenshotFilename,
  resolveDurableScreenshotPath,
  resolveSafeArtifactPath,
  sanitizeReportId,
  sanitizeScreenshotFilename,
} from '../../src/storage/qa-artifacts.js';
import { ensureDataDirectories, getStoragePaths } from '../../src/storage/mod.js';

describe('qa artifact path safety (Milestone 3)', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-artifacts-'));
    await ensureDataDirectories(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('resolves qa artifact directories under /data', () => {
    const paths = getStoragePaths(dataDir);
    expect(paths.qaArtifactsDir).toContain('qa-artifacts');
    expect(paths.qaScreenshotsDir).toMatch(/qa-artifacts[\\/]screenshots$/);
    expect(getQaArtifactPaths(dataDir).screenshotsRoot).toBe(paths.qaScreenshotsDir);
  });

  it('resolveSafeArtifactPath rejects traversal attempts', () => {
    const root = path.join(dataDir, 'qa-artifacts', 'screenshots', 'report-1');
    expect(() => resolveSafeArtifactPath('../evil.png', root)).toThrow(/traversal/i);
    expect(() => resolveSafeArtifactPath('../../etc/passwd', root)).toThrow(/traversal/i);
  });

  it('resolveDurableScreenshotPath keeps files inside the report-scoped folder', () => {
    const { fullPath, relativePath, filename } = resolveDurableScreenshotPath(
      dataDir,
      '2026-06-01T12-00-00-000Z-login-flow',
      'step-1.png'
    );

    expect(filename).toBe('step-1.png');
    expect(relativePath).toBe('2026-06-01T12-00-00-000Z-login-flow/step-1.png');
    expect(fullPath.startsWith(getQaArtifactPaths(dataDir).screenshotsRoot + path.sep)).toBe(true);
  });

  it('sanitizeScreenshotFilename strips directories and enforces image extension', () => {
    expect(sanitizeScreenshotFilename('../secrets.txt')).toBe('secrets.txt.png');
    expect(sanitizeScreenshotFilename('capture.JPG')).toBe('capture.JPG');
    expect(isAllowedScreenshotFilename('capture.JPG')).toBe(true);
    expect(isAllowedScreenshotFilename('capture.gif')).toBe(false);
  });

  it('sanitizeReportId rejects empty ids after stripping', () => {
    expect(sanitizeReportId('report-123')).toBe('report-123');
    expect(() => sanitizeReportId('@@@')).toThrow(/invalid report id/i);
    expect(() => sanitizeReportId('..')).toThrow(/invalid report id/i);
  });
});

describe('durable screenshot copy (Milestone 3)', () => {
  let dataDir: string;
  let tmpDir: string;
  const reportId = '2026-06-01T12-00-00-000Z-login-flow';

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-artifacts-data-'));
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-artifacts-tmp-'));
    await ensureDataDirectories(dataDir);
    await mkdir(path.join(tmpDir, 'screenshots'), { recursive: true });
    await writeFile(path.join(tmpDir, 'screenshots', 'step-1.png'), 'fake-png-bytes');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('copies a TMP_DIR screenshot into /data/qa-artifacts/screenshots/<reportId>/', async () => {
    const meta = await copyTmpScreenshotToDurable(
      dataDir,
      tmpDir,
      reportId,
      'screenshots/step-1.png'
    );

    expect(meta).toEqual({
      filename: 'step-1.png',
      path: `${reportId}/step-1.png`,
      label: 'screenshots/step-1.png',
    });

    const durablePath = path.join(
      getQaArtifactPaths(dataDir).screenshotsRoot,
      reportId,
      'step-1.png'
    );
    await expect(access(durablePath)).resolves.toBeUndefined();
  });

  it('skips tmp paths outside TMP_DIR', async () => {
    const meta = await copyTmpScreenshotToDurable(dataDir, tmpDir, reportId, '../outside.png');
    expect(meta).toBeNull();
  });
});
