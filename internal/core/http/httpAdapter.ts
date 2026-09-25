export interface HttpAdapterRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit | null;
  signal: AbortSignal;
}

/** Transport contract accepted by both Authyon clients. */
export interface HttpAdapter {
  request(request: HttpAdapterRequest): Promise<Response>;
}

export type HttpLogEvent =
  | {
      type: "request";
      method: string;
      url: string;
      timestamp: number;
    }
  | {
      type: "response";
      method: string;
      url: string;
      status: number;
      durationMs: number;
      requestId?: string;
      timestamp: number;
    }
  | {
      type: "error";
      method: string;
      url: string;
      errorName: string;
      durationMs: number;
      timestamp: number;
    };

/** Receives sanitized HTTP lifecycle events. Headers, bodies and query values are never exposed. */
export type HttpLogger = (event: HttpLogEvent) => void;

/**
 * Mutable logging configuration. Change `enabled` at runtime to enable or disable logging
 * without recreating the Authyon client.
 */
export interface HttpLoggerOptions {
  enabled: boolean;
  logger?: HttpLogger;
}

/** Default adapter backed by the platform's Fetch API. */
export class FetchHttpAdapter implements HttpAdapter {
  constructor(private readonly fetchImpl: typeof fetch = fetch.bind(globalThis)) {}

  request(request: HttpAdapterRequest): Promise<Response> {
    return this.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      redirect: "error",
    });
  }
}

/** Adds safe, configurable lifecycle logging to any HTTP adapter. */
export class LoggingHttpAdapter implements HttpAdapter {
  constructor(
    private readonly adapter: HttpAdapter,
    private readonly options: HttpLoggerOptions,
  ) {}

  async request(request: HttpAdapterRequest): Promise<Response> {
    const startedAt = Date.now();
    const eventBase = {
      method: request.method,
      url: sanitizeUrl(request.url),
    };
    this.log({ type: "request", ...eventBase, timestamp: startedAt });

    try {
      const response = await this.adapter.request(request);
      this.log({
        type: "response",
        ...eventBase,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestId:
          response.headers.get("x-request-id") ?? response.headers.get("trace-id") ?? undefined,
        timestamp: Date.now(),
      });
      return response;
    } catch (error) {
      this.log({
        type: "error",
        ...eventBase,
        errorName: error instanceof Error ? error.name : "UnknownError",
        durationMs: Date.now() - startedAt,
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  private log(event: HttpLogEvent): void {
    if (!this.options.enabled) return;
    const logger = this.options.logger ?? defaultHttpLogger;
    try {
      logger(event);
    } catch {
      // Observability must never interrupt an authentication request.
    }
  }
}

function defaultHttpLogger(event: HttpLogEvent): void {
  console.debug("[Authyon HTTP]", event);
}

function sanitizeUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.hash = "";
  const queryKeys = new Set<string>();
  url.searchParams.forEach((_value, key) => queryKeys.add(key));
  url.search =
    queryKeys.size > 0
      ? [...queryKeys].map((key) => `${encodeURIComponent(key)}=REDACTED`).join("&")
      : "";
  return url.toString();
}
