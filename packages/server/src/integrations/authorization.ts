import {
  createAuthyonAbility,
  type AbilitySubject,
  type AuthyonAbility,
  type AuthyonAbilityOptions,
} from "../../../../internal/core/authorization/ability";
import type { AuthyonServerClient } from "../client/authyonServerClient";
import { normalizeClientIp } from "../../../../internal/core/http/clientIp";
import type { JwksTokenVerifier } from "../security/jwksTokenVerifier";
import { TokenVerificationError } from "../security/jwksTokenVerifier";

export interface AbilityRequirement {
  action: string;
  subject: AbilitySubject;
  field?: string;
}

export interface AuthorizationContext {
  token: string;
  userId?: string;
  ability: AuthyonAbility;
  permissions: readonly string[];
  roles: readonly string[];
}

export interface AuthorizationOptions extends AuthyonAbilityOptions {
  requirement?: AbilityRequirement;
  /** Uses database-backed validation by default; introspection can be selected when desired. */
  verification?: "validate" | "introspect" | "jwks";
  /** Required for local JWKS verification. Create once and reuse its key cache. */
  jwksVerifier?: JwksTokenVerifier;
  /** Real end-user IP, obtained from trusted application infrastructure. */
  clientIp?: string;
}

export class AuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly code:
      "authorization.unauthenticated" | "authorization.forbidden" | "authorization.unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Validates a bearer token and creates an Authyon-backed ability for server runtimes. */
export async function authorizeToken(
  client: AuthyonServerClient,
  token: string,
  options: AuthorizationOptions = {},
): Promise<AuthorizationContext> {
  if (!token) throw unauthenticated();

  let userId: string | undefined;
  let permissions: string[] = [];
  let roles: string[] = [];
  let scope: string | undefined;

  if (options.verification === "jwks") {
    if (!options.jwksVerifier) {
      throw new Error("Authyon: `jwksVerifier` is required for JWKS verification");
    }
    let verified;
    try {
      verified = await options.jwksVerifier.verifyAccessToken(token);
    } catch (error) {
      if (!(error instanceof TokenVerificationError)) throw error;
      if (error.code === "token.key_unavailable") {
        throw new AuthorizationError(
          503,
          "authorization.unavailable",
          "Token verification is temporarily unavailable",
        );
      }
      throw unauthenticated();
    }
    const { claims } = verified;
    userId = claims.sub;
    permissions = claims.permissions ?? [];
    roles = claims.roles ?? [];
    scope = claims.scope;
  } else if (options.verification === "introspect") {
    const identity = await client.introspect(token, { clientIp: options.clientIp });
    if (!identity.active) throw unauthenticated();
    userId = identity.sub;
    permissions = identity.permissions ?? [];
    roles = identity.roles ?? [];
    scope = identity.scope;
  } else {
    const identity = await client.validate(token, { clientIp: options.clientIp });
    if (!identity.valid || !identity.user) throw unauthenticated();
    userId = identity.user.id;
    permissions = identity.user.permissions ?? [];
  }

  const ability = createAuthyonAbility(
    { permissions, roles, scope },
    {
      rules: options.rules,
      roleRules: options.roleRules,
      roles: options.roles,
      detectSubjectType: options.detectSubjectType,
    },
  );
  if (options.requirement && !canAccess(ability, options.requirement)) {
    throw new AuthorizationError(403, "authorization.forbidden", "Permission denied");
  }
  return { token, userId, ability, permissions, roles };
}

/** Works with Web Request objects used by Next.js Route Handlers and other Fetch runtimes. */
export function authorizeRequest(
  client: AuthyonServerClient,
  request: Pick<Request, "headers">,
  options: RequestAuthorizationOptions = {},
): Promise<AuthorizationContext> {
  const clientIp = options.resolveClientIp?.(request) ?? options.clientIp;
  return authorizeToken(client, bearerToken(request.headers.get("authorization")), {
    ...options,
    clientIp,
  });
}

export interface RequestAuthorizationOptions extends AuthorizationOptions {
  /** Platform-aware resolver. Only read headers that your trusted proxy overwrites. */
  resolveClientIp?: (request: Pick<Request, "headers">) => string | undefined;
}

export interface ExpressRequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  authyon?: AuthorizationContext;
}

export interface ExpressResponseLike {
  status(code: number): ExpressResponseLike;
  json(body: unknown): unknown;
}

export type ExpressNext = (error?: unknown) => void;

export interface ExpressAuthorizationMiddlewareOptions extends AuthorizationOptions {
  /** Property assigned to the request. Defaults to `authyon`. */
  requestProperty?: string;
  /** Pass authorization errors to Express error middleware instead of writing a JSON response. */
  passErrorsToNext?: boolean;
  /** Trust Express's proxy-aware `request.ip`. Disabled by default. */
  trustProxy?: boolean;
  /** Overrides all built-in IP resolution; return only a trusted, single client IP. */
  resolveClientIp?: (request: ExpressRequestLike) => string | undefined;
}

/** Dependency-free middleware compatible with Express and similar Connect frameworks. */
export function createExpressAuthorizationMiddleware(
  client: AuthyonServerClient,
  options: ExpressAuthorizationMiddlewareOptions = {},
) {
  return async (
    request: ExpressRequestLike & Record<string, unknown>,
    response: ExpressResponseLike,
    next: ExpressNext,
  ): Promise<void> => {
    try {
      const header = request.headers.authorization;
      const clientIp = resolveExpressClientIp(request, options);
      const context = await authorizeToken(
        client,
        bearerToken(Array.isArray(header) ? header[0] : header),
        { ...options, clientIp },
      );
      request[options.requestProperty ?? "authyon"] = context;
      next();
    } catch (error) {
      if (options.passErrorsToNext || !(error instanceof AuthorizationError)) {
        next(error);
        return;
      }
      response.status(error.status).json({ code: error.code, message: error.message });
    }
  };
}

function resolveExpressClientIp(
  request: ExpressRequestLike,
  options: ExpressAuthorizationMiddlewareOptions,
): string | undefined {
  const resolved =
    options.resolveClientIp?.(request) ??
    (options.trustProxy ? request.ip : request.socket?.remoteAddress);
  return resolved ? normalizeClientIp(stripIpv4Prefix(resolved)) : undefined;
}

function stripIpv4Prefix(value: string): string {
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

/** Converts an authorization error into a Fetch Response suitable for Next.js. */
export function createAuthorizationErrorResponse(error: unknown): Response {
  if (!(error instanceof AuthorizationError)) throw error;
  return Response.json({ code: error.code, message: error.message }, { status: error.status });
}

function canAccess(ability: AuthyonAbility, requirement: AbilityRequirement): boolean {
  return ability.can(requirement.action, requirement.subject, requirement.field);
}

function bearerToken(header: string | null | undefined): string {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw unauthenticated();
  return match[1].trim();
}

function unauthenticated(): AuthorizationError {
  return new AuthorizationError(
    401,
    "authorization.unauthenticated",
    "A valid bearer token is required",
  );
}
