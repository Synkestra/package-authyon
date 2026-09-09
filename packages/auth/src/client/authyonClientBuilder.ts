import type { HttpAdapter, HttpLoggerOptions } from "../../../../internal/core/http/httpAdapter";
import { AuthyonClient } from "./authyonClient";
import type { AuthyonClientOptions, TokenStorage } from "../contracts/auth";

/** Builds an Authyon browser client through explicit, progressive configuration. */
export class AuthyonClientBuilder {
  private readonly options: AuthyonClientOptions;

  constructor(envKey: string) {
    this.options = { envKey };
  }

  withBaseUrl(baseUrl: string, allowInsecureHttp = false): this {
    this.options.baseUrl = baseUrl;
    this.options.allowInsecureHttp = allowInsecureHttp;
    return this;
  }

  withStorage(storage: TokenStorage): this {
    this.options.storage = storage;
    return this;
  }

  withAutomaticRefresh(enabled = true): this {
    this.options.autoRefresh = enabled;
    return this;
  }

  withTimeout(timeoutMs: number): this {
    this.options.timeoutMs = timeoutMs;
    return this;
  }

  withHttpAdapter(httpAdapter: HttpAdapter): this {
    this.options.httpAdapter = httpAdapter;
    return this;
  }

  withHttpLogger(httpLogger: HttpLoggerOptions): this {
    this.options.httpLogger = httpLogger;
    return this;
  }

  build(): AuthyonClient {
    return new AuthyonClient({ ...this.options });
  }
}
