import type { HttpAdapter, HttpLoggerOptions } from "../../../../internal/core/http/httpAdapter";
import type { AuthyonServerClientOptions } from "../contracts/server";
import { AuthyonServerClient } from "./authyonServerClient";

/** Builds a server client while keeping environment credentials grouped. */
export class AuthyonServerClientBuilder {
  readonly #options: AuthyonServerClientOptions = {};

  withEnvironmentKey(envKey: string): this {
    this.#options.envKey = envKey;
    return this;
  }

  withEnvironmentCredentials(clientId: string, clientSecret: string): this {
    this.#options.clientId = clientId;
    this.#options.clientSecret = clientSecret;
    return this;
  }

  withBaseUrl(baseUrl: string, allowInsecureHttp = false): this {
    this.#options.baseUrl = baseUrl;
    this.#options.allowInsecureHttp = allowInsecureHttp;
    return this;
  }

  withTimeout(timeoutMs: number): this {
    this.#options.timeoutMs = timeoutMs;
    return this;
  }

  withHttpAdapter(httpAdapter: HttpAdapter): this {
    this.#options.httpAdapter = httpAdapter;
    return this;
  }

  withHttpLogger(httpLogger: HttpLoggerOptions): this {
    this.#options.httpLogger = httpLogger;
    return this;
  }

  build(): AuthyonServerClient {
    return new AuthyonServerClient({ ...this.#options });
  }
}
