import { AuthyonError } from "../errors/authyonError";
import { appendQuery, type QueryParams } from "./query";
import { responseMetadata, SharedTransportError, type createSharedTransport } from "./transport";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface JsonRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: QueryParams;
  headers?: Record<string, string>;
}

/** Shared JSON request/response handling. Authentication remains package-specific. */
export class JsonHttpClient {
  constructor(private readonly transport: ReturnType<typeof createSharedTransport>) {}

  async send(path: string, options: JsonRequestOptions = {}): Promise<Response> {
    const headers = { ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await this.transport.request(appendQuery(path, options.query), {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (cause) {
      if (!(cause instanceof SharedTransportError)) throw cause;
      throw new AuthyonError(0, { code: cause.code, title: cause.message }, { cause: cause.cause });
    }
  }

  async parse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let body: Record<string, string> = {};
      try {
        body = await response.json();
      } catch {
        // Non-JSON error response; status and metadata still remain available.
      }
      throw new AuthyonError(response.status, body, responseMetadata(response));
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async request<T>(path: string, options: JsonRequestOptions = {}): Promise<T> {
    return this.parse<T>(await this.send(path, options));
  }
}
