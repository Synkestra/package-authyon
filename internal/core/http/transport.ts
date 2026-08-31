import { ErrorCodes } from "../errors/authyonError";
import {
  FetchHttpAdapter,
  LoggingHttpAdapter,
  type HttpAdapter,
  type HttpLoggerOptions,
} from "./httpAdapter";

export const DEFAULT_TIMEOUT_MS = 15_000;

export interface SharedTransportOptions {
  baseUrl: string;
  allowInsecureHttp?: boolean;
  timeoutMs?: number;
  httpAdapter?: HttpAdapter;
  httpLogger?: HttpLoggerOptions;
  /** @deprecated Prefer `httpAdapter`. */
  fetch?: typeof fetch;
}

export interface ResponseMetadata {
  requestId?: string;
  retryAfter?: number;
}

export class SharedTransportError extends Error {
  readonly code: typeof ErrorCodes.Timeout | typeof ErrorCodes.NetworkError;
  readonly cause: unknown;

  constructor(code: SharedTransportError["code"], cause: unknown) {
    super(code === "request.timeout" ? "Request timed out" : "Network request failed");
    this.name = "SharedTransportError";
    this.code = code;
    this.cause = cause;
  }
}

/** Shared, authentication-agnostic HTTP component used by both public SDKs. */
export function createSharedTransport(options: SharedTransportOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl, options.allowInsecureHttp ?? false);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("Authyon: `timeoutMs` must be a non-negative finite number");
  }
  if (options.httpAdapter && options.fetch) {
    throw new Error("Authyon: use either `httpAdapter` or `fetch`, not both");
  }
  const baseAdapter = options.httpAdapter ?? new FetchHttpAdapter(options.fetch);
  const httpAdapter = options.httpLogger
    ? new LoggingHttpAdapter(baseAdapter, options.httpLogger)
    : baseAdapter;

  return {
    baseUrl,
    async request(path: string, init: RequestInit): Promise<Response> {
      const controller = new AbortController();
      const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      try {
        return await httpAdapter.request({
          url: `${baseUrl}${path}`,
          method: init.method ?? "GET",
          headers: normalizeHeaders(init.headers),
          body: init.body,
          signal: controller.signal,
        });
      } catch (cause) {
        throw new SharedTransportError(
          controller.signal.aborted ? ErrorCodes.Timeout : ErrorCodes.NetworkError,
          cause,
        );
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  const normalized: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    normalized[key] = value;
  });
  return normalized;
}

export function responseMetadata(response: Response): ResponseMetadata {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  return {
    requestId:
      response.headers.get("x-request-id") ?? response.headers.get("trace-id") ?? undefined,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
  };
}

function normalizeBaseUrl(value: string, allowInsecureHttp: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Authyon: `baseUrl` must be an absolute URL");
  }
  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (loopback || allowInsecureHttp))) {
    throw new Error(
      "Authyon: `baseUrl` must use HTTPS (HTTP is allowed only for loopback or with `allowInsecureHttp`)",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Authyon: `baseUrl` cannot contain credentials, query parameters, or fragments",
    );
  }
  return url.toString().replace(/\/+$/, "");
}
