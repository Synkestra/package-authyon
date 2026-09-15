import { AuthyonError } from "../errors";
import {
  BffSessionError,
  type BffSessionOptions,
  type BffLoginInput,
  type BffSessionPersistence,
  type BffVerifyTwoFactorInput,
} from "./contracts";

const MAX_BODY_BYTES = 16_384;
const SESSION_ID = /^[a-f0-9]{64}$/;

export function createBffHttp(options: BffSessionOptions) {
  const url = new URL(options.origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const insecure = url.protocol === "http:" && loopback && options.allowInsecureLocalhost === true;
  if ((!insecure && url.protocol !== "https:") || url.origin !== options.origin) {
    throw new Error("Authyon BFF: origin must be an HTTPS origin, without path or credentials");
  }
  const cookieName = insecure ? "authyon.session" : "__Host-authyon.session";
  const attributes = `Path=/; HttpOnly; SameSite=Lax${insecure ? "" : "; Secure"}`;

  function assertRequest(request: Request) {
    if (new URL(request.url).origin !== options.origin)
      throw new BffSessionError("request.origin_denied", 403);
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== options.origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      throw new BffSessionError("request.origin_denied", 403);
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      if (origin !== options.origin || request.headers.get("x-authyon-csrf") !== "1") {
        throw new BffSessionError("request.csrf_denied", 403);
      }
    }
  }

  function sessionId(request: Request): string | null {
    const matches = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${cookieName}=`));
    if (matches.length > 1) throw new BffSessionError("session.ambiguous_cookie", 401, true);
    const value = matches[0]?.slice(cookieName.length + 1);
    return value && SESSION_ID.test(value) ? value : null;
  }

  function response(body: unknown, init: { status?: number; cookie?: string } = {}) {
    const headers = new Headers({
      "cache-control": "no-store",
      pragma: "no-cache",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
    });
    if (init.cookie) headers.set("set-cookie", init.cookie);
    if (body !== null) headers.set("content-type", "application/json");
    return new Response(body === null ? null : JSON.stringify(body), {
      status: init.status ?? 200,
      headers,
    });
  }

  function expireCookie() {
    return `${cookieName}=; ${attributes}; Max-Age=0`;
  }

  function errorResponse(error: unknown) {
    if (error instanceof BffSessionError) {
      return response(
        { error: { code: error.code } },
        { status: error.status, cookie: error.clearCookie ? expireCookie() : undefined },
      );
    }
    if (error instanceof AuthyonError) {
      const status = [400, 401, 403, 429].includes(error.status) ? error.status : 503;
      const result = response(
        { error: { code: status === 503 ? "provider.unavailable" : "provider.rejected" } },
        { status },
      );
      if (error.retryAfter !== undefined)
        result.headers.set("retry-after", String(error.retryAfter));
      return result;
    }
    return response({ error: { code: "session.unavailable" } }, { status: 503 });
  }

  return {
    assertRequest,
    sessionId,
    response,
    expireCookie,
    errorResponse,
    cookie(id: string, expiresAt: number) {
      return `${cookieName}=${id}; ${attributes}; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`;
    },
  };
}

export async function readBffBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  ) {
    throw new BffSessionError("request.json_required", 415);
  }
  if (!request.body) throw new BffSessionError("request.invalid_body", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new BffSessionError("request.body_too_large", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("invalid JSON object");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BffSessionError) throw error;
    throw new BffSessionError("request.invalid_body", 400);
  } finally {
    reader.releaseLock();
  }
}

export function inputString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || value.length === 0)
    throw new BffSessionError("request.invalid_body", 400);
  return value;
}

function sessionPersistence(body: Record<string, unknown>): BffSessionPersistence {
  const value = body.sessionPersistence;
  if (value === undefined || value === "standard") return "standard";
  if (value === "remembered") return "remembered";
  throw new BffSessionError("request.invalid_body", 400);
}

export function loginInput(body: Record<string, unknown>): BffLoginInput {
  return {
    password: inputString(body, "password"),
    ...(body.email !== undefined
      ? { email: inputString(body, "email") }
      : { username: inputString(body, "username") }),
    ...(body.organizationSlug !== undefined
      ? { organizationSlug: inputString(body, "organizationSlug") }
      : {}),
    sessionPersistence: sessionPersistence(body),
  };
}

export function twoFactorInput(body: Record<string, unknown>): BffVerifyTwoFactorInput {
  const method = inputString(body, "method");
  const challengeToken = inputString(body, "challengeToken");
  const persistence = sessionPersistence(body);
  if (method !== "webauthn") {
    return {
      challengeToken,
      method,
      code: inputString(body, "code"),
      sessionPersistence: persistence,
    };
  }
  const assertion = body.webAuthnAssertion;
  if (!assertion || typeof assertion !== "object" || Array.isArray(assertion))
    throw new BffSessionError("request.invalid_body", 400);
  const fields = assertion as Record<string, unknown>;
  return {
    challengeToken,
    method,
    sessionPersistence: persistence,
    webAuthnAssertion: {
      ceremonyToken: inputString(fields, "ceremonyToken"),
      assertionJson: inputString(fields, "assertionJson"),
    },
  };
}
