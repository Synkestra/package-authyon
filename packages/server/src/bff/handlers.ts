import { BffSessionError, type BffSessionOptions, type BffSessionRecord } from "./contracts";
import { createBffHttp, inputString, loginInput, readBffBody, twoFactorInput } from "./http";
import { BffSessionManager } from "./sessionManager";

function publicSession(record: BffSessionRecord) {
  return { authenticated: true, user: record.user, expiresAt: record.expiresAt };
}

/** Mount each handler explicitly. Never expose a catch-all proxy for the provider. */
export function createBffSession(options: BffSessionOptions) {
  const http = createBffHttp(options);
  const manager = new BffSessionManager(options);

  function requiredSessionId(request: Request) {
    const id = http.sessionId(request);
    if (!id) throw new BffSessionError("session.missing", 401, true);
    return id;
  }

  function handler(method: string, action: (request: Request) => Promise<Response>) {
    return async (request: Request): Promise<Response> => {
      try {
        if (request.method !== method) {
          const response = http.response(
            { error: { code: "request.method_not_allowed" } },
            { status: 405 },
          );
          response.headers.set("allow", method);
          return response;
        }
        http.assertRequest(request);
        return await action(request);
      } catch (error) {
        return http.errorResponse(error);
      }
    };
  }

  async function finishLogin(
    tokens: Parameters<BffSessionManager["create"]>[0],
    organizationSlug?: string,
  ) {
    const { id, record } = await manager.create(tokens, organizationSlug);
    return http.response(publicSession(record), { cookie: http.cookie(id, record.expiresAt) });
  }

  async function assertSignedOut(request: Request) {
    const id = http.sessionId(request);
    if (!id) return;
    try {
      await manager.read(id);
    } catch (error) {
      if (error instanceof BffSessionError && error.status === 401) return;
      throw error;
    }
    throw new BffSessionError("session.already_authenticated", 409);
  }

  return {
    login: handler("POST", async (request) => {
      await assertSignedOut(request);
      const input = loginInput(await readBffBody(request));
      const result = await options.provider.login(input);
      if ("twoFactorRequired" in result) {
        return http.response({
          twoFactorRequired: true,
          challengeToken: result.challengeToken,
          methods: result.methods,
        });
      }
      return finishLogin(result, input.organizationSlug);
    }),
    verifyTwoFactor: handler("POST", async (request) => {
      await assertSignedOut(request);
      const tokens = await options.provider.verifyTwoFactor(
        twoFactorInput(await readBffBody(request)),
      );
      return finishLogin(tokens);
    }),
    session: handler("GET", async (request) =>
      http.response(publicSession(await manager.read(requiredSessionId(request)))),
    ),
    switchOrganization: handler("POST", async (request) => {
      const slug = inputString(await readBffBody(request), "organizationSlug");
      return http.response(
        publicSession(await manager.switchOrganization(requiredSessionId(request), slug)),
      );
    }),
    logout: handler("POST", async (request) => {
      const id = http.sessionId(request);
      if (id) {
        try {
          await manager.logout(id);
        } catch (error) {
          if (!(error instanceof BffSessionError) || error.status !== 401) throw error;
        }
      }
      return http.response(null, { status: 204, cookie: http.expireCookie() });
    }),
    /** Server-only credential for downstream calls. Never serialize this result to the browser. */
    async requireSession(request: Request) {
      http.assertRequest(request);
      const record = await manager.read(requiredSessionId(request));
      return {
        accessToken: record.tokens.accessToken,
        user: record.user,
        expiresAt: record.expiresAt,
      };
    },
    errorResponse: http.errorResponse,
  };
}
