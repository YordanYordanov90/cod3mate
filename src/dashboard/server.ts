import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import {
  getDashboardReportById,
  listDashboardProjects,
  listDashboardReports,
  loadDashboardReportsFromDisk,
  sanitizeDashboardResponse,
} from './reports-api.js';
import { listReportScreenshots, readDashboardScreenshot } from './screenshots-api.js';
import { getDashboardTranscriptByReportId } from './transcript-api.js';

/**
 * Railway Dashboard API — Milestones 4–6 (health, reports, screenshots).
 *
 * Security model (see context/dashboard.md):
 *  - `/health` is an unauthenticated liveness probe for Railway.
 *  - Every `/api/dashboard/*` route requires a server-to-server bearer token.
 *  - JSON responses are sanitized before they leave the process.
 *  - Screenshot binaries are served only from `/data/qa-artifacts/screenshots/`.
 *  - Bot long-polling is never touched by this server.
 */

export const DASHBOARD_SERVICE_NAME = 'cod3mate-dashboard-api';

export interface DashboardJsonRouteResult {
  kind: 'json';
  status: number;
  body: Record<string, unknown>;
}

export interface DashboardBinaryRouteResult {
  kind: 'binary';
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export type DashboardRouteResult = DashboardJsonRouteResult | DashboardBinaryRouteResult;

export interface DashboardServerContext {
  token: string;
  dataDir: string;
}

interface MinimalRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers: IncomingHttpHeaders;
}

/** Constant-time bearer token comparison (guards against length leaks). */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function extractBearerToken(authHeader: string | string[] | undefined): string | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match && match[1] ? match[1].trim() : null;
}

function parseRequestUrl(url: string | undefined): { pathname: string; searchParams: URLSearchParams } {
  const raw = url ?? '/';
  const q = raw.indexOf('?');
  const pathname = (q === -1 ? raw : raw.slice(0, q)) || '/';
  const query = q === -1 ? '' : raw.slice(q + 1);
  return { pathname, searchParams: new URLSearchParams(query) };
}

function json(status: number, body: Record<string, unknown>): DashboardJsonRouteResult {
  return { kind: 'json', status, body };
}

function unauthorized(): DashboardJsonRouteResult {
  return json(401, { ok: false, error: 'Unauthorized' });
}

function notFound(): DashboardJsonRouteResult {
  return json(404, { ok: false, error: 'Not found' });
}

function ok(body: Record<string, unknown>): DashboardJsonRouteResult {
  return json(200, sanitizeDashboardResponse(body));
}

function screenshotErrorStatus(error: 'invalid_report' | 'invalid_extension' | 'traversal' | 'not_found'): number {
  if (error === 'invalid_extension' || error === 'traversal') {
    return 400;
  }
  return 404;
}

async function handleScreenshotBinaryRoute(
  reportId: string,
  filename: string,
  ctx: DashboardServerContext
): Promise<DashboardRouteResult> {
  if (!reportId || !filename || reportId.includes('/') || filename.includes('/')) {
    return notFound();
  }

  const result = await readDashboardScreenshot(ctx.dataDir, decodeURIComponent(reportId), filename);
  if (!result.ok) {
    return json(screenshotErrorStatus(result.error), { ok: false, error: 'Not found' });
  }

  return {
    kind: 'binary',
    status: 200,
    headers: {
      'Content-Type': result.file.contentType,
      'Cache-Control': result.file.cacheControl,
    },
    body: result.file.body,
  };
}

async function handleAuthenticatedDashboardRoute(
  pathname: string,
  searchParams: URLSearchParams,
  ctx: DashboardServerContext
): Promise<DashboardRouteResult> {
  if (pathname === '/api/dashboard/health') {
    return ok({ ok: true, service: DASHBOARD_SERVICE_NAME, status: 'ok' });
  }

  if (pathname === '/api/dashboard/projects') {
    const reports = await loadDashboardReportsFromDisk(ctx.dataDir);
    const projects = listDashboardProjects(reports);
    return ok({ ok: true, projects });
  }

  if (pathname === '/api/dashboard/reports') {
    const project = searchParams.get('project') ?? undefined;
    const cursor = searchParams.get('cursor') ?? undefined;
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw != null ? Number(limitRaw) : undefined;

    const reports = await loadDashboardReportsFromDisk(ctx.dataDir);
    const page = listDashboardReports(reports, { project, cursor, limit });
    return ok({
      ok: true,
      reports: page.reports,
      nextCursor: page.nextCursor,
    });
  }

  const screenshotsBinaryPrefix = '/api/dashboard/screenshots/';
  if (pathname.startsWith(screenshotsBinaryPrefix)) {
    const remainder = pathname.slice(screenshotsBinaryPrefix.length);
    const slash = remainder.indexOf('/');
    if (slash === -1) {
      return notFound();
    }
    const reportId = remainder.slice(0, slash);
    const filename = remainder.slice(slash + 1);
    return handleScreenshotBinaryRoute(reportId, filename, ctx);
  }

  const reportDetailPrefix = '/api/dashboard/reports/';
  if (pathname.startsWith(reportDetailPrefix)) {
    const remainder = pathname.slice(reportDetailPrefix.length);
    const transcriptSuffix = '/transcript';
    const screenshotsSuffix = '/screenshots';

    if (remainder.endsWith(transcriptSuffix)) {
      const reportId = remainder.slice(0, -transcriptSuffix.length);
      if (!reportId || reportId.includes('/')) {
        return notFound();
      }

      const transcript = await getDashboardTranscriptByReportId(
        ctx.dataDir,
        decodeURIComponent(reportId)
      );
      if (!transcript) {
        return notFound();
      }

      return ok({ ok: true, transcript });
    }

    if (remainder.endsWith(screenshotsSuffix)) {
      const reportId = remainder.slice(0, -screenshotsSuffix.length);
      if (!reportId || reportId.includes('/')) {
        return notFound();
      }

      const screenshots = await listReportScreenshots(ctx.dataDir, decodeURIComponent(reportId));
      if (!screenshots) {
        return notFound();
      }

      return ok({ ok: true, screenshots });
    }

    if (!remainder || remainder.includes('/')) {
      return notFound();
    }

    const report = await getDashboardReportById(ctx.dataDir, decodeURIComponent(remainder));
    if (!report) {
      return notFound();
    }

    return ok({ ok: true, report });
  }

  return notFound();
}

/**
 * Pure request router. Async only where disk I/O is required.
 */
export async function routeDashboardRequest(
  req: MinimalRequest,
  ctx: DashboardServerContext
): Promise<DashboardRouteResult> {
  const method = (req.method ?? 'GET').toUpperCase();
  const { pathname, searchParams } = parseRequestUrl(req.url);

  if (method !== 'GET') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  if (pathname === '/health') {
    return json(200, { ok: true, service: DASHBOARD_SERVICE_NAME, status: 'ok' });
  }

  if (pathname === '/api/dashboard' || pathname.startsWith('/api/dashboard/')) {
    const provided = extractBearerToken(req.headers.authorization);
    if (!provided || !tokensMatch(provided, ctx.token)) {
      return unauthorized();
    }

    return handleAuthenticatedDashboardRoute(pathname, searchParams, ctx);
  }

  return notFound();
}

export function writeDashboardRouteResult(res: ServerResponse, result: DashboardRouteResult): void {
  if (result.kind === 'binary') {
    res.writeHead(result.status, result.headers);
    res.end(result.body);
    return;
  }

  const payload = JSON.stringify(result.body);
  res.writeHead(result.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export interface DashboardServerOptions {
  token: string;
  dataDir: string;
  port: number;
  logger?: Pick<Console, 'log' | 'error'>;
}

export interface DashboardServerHandle {
  /** Actual bound port (useful when `port: 0` is requested in tests). */
  port: number;
  /** Resolves once the HTTP server has fully closed. */
  close: () => Promise<void>;
}

/**
 * Build the request handler used by the HTTP server. Exposed for tests.
 */
export function createDashboardRequestListener(
  options: Pick<DashboardServerOptions, 'token' | 'dataDir'>
): http.RequestListener {
  const ctx: DashboardServerContext = {
    token: options.token,
    dataDir: options.dataDir,
  };

  return (req, res) => {
    void (async () => {
      try {
        const result = await routeDashboardRequest(req, ctx);
        writeDashboardRouteResult(res, result);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
        } else {
          res.end();
        }
      }
    })();
  };
}

/**
 * Start the dashboard HTTP server. Resolves once it is listening.
 */
export function startDashboardServer(
  options: DashboardServerOptions
): Promise<DashboardServerHandle> {
  const logger = options.logger ?? console;
  const server = http.createServer(createDashboardRequestListener(options));

  return new Promise<DashboardServerHandle>((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener('error', onError);
      reject(err);
    };
    server.once('error', onError);

    server.listen(options.port, () => {
      server.removeListener('error', onError);
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : options.port;
      logger.log(`[dashboard-api] listening on port ${boundPort}`);

      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          }),
      });
    });
  });
}
