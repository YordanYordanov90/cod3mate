export type DashboardApiErrorCode =
  | "unavailable"
  | "auth"
  | "invalid_response"
  | "not_found"
  | "unknown";

export class DashboardApiError extends Error {
  readonly code: DashboardApiErrorCode;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: DashboardApiErrorCode,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message);
    this.name = "DashboardApiError";
    this.code = code;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
