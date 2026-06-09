import { getRailwayApiEnv } from "@/lib/railway-api-env";
import { isSignedIn } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = /\.(png|jpe?g)$/i;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function isSafeFilename(filename: string): boolean {
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return false;
  }
  return ALLOWED_EXTENSIONS.test(filename);
}

function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Server-side proxy for private QA screenshots.
 *
 * The Railway screenshot API requires a server-to-server bearer token that must
 * never reach the browser. This route fetches the binary on the server and
 * streams it back, so `<img src>` can stay token-free. Inputs are validated
 * here (defense in depth) even though Railway also enforces containment.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string; filename: string }> },
): Promise<Response> {
  const { reportId, filename } = await params;

  // Authentication: Clerk middleware guarantees this, but re-check defensively.
  if (!(await isSignedIn())) {
    return new Response("Not found", { status: 404 });
  }

  if (!isSafeFilename(filename)) {
    return new Response("Invalid screenshot path", { status: 400 });
  }

  let env: ReturnType<typeof getRailwayApiEnv>;
  try {
    env = getRailwayApiEnv();
  } catch {
    return new Response("Dashboard API not configured", { status: 503 });
  }

  const baseUrl = env.DASHBOARD_API_BASE_URL.replace(/\/$/, "");
  const target = `${baseUrl}/api/dashboard/screenshots/${encodeURIComponent(
    reportId,
  )}/${encodeURIComponent(filename)}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: { Authorization: `Bearer ${env.DASHBOARD_API_TOKEN}` },
      cache: "no-store",
    });
  } catch {
    return new Response("Screenshot upstream unavailable", { status: 502 });
  }

  if (upstream.status === 404) {
    return new Response("Screenshot not found", { status: 404 });
  }

  if (!upstream.ok) {
    return new Response("Screenshot unavailable", { status: 502 });
  }

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? contentTypeFor(filename),
      "Cache-Control": "private, max-age=300",
      "Content-Length": String(body.byteLength),
    },
  });
}
