import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyResult,
  type JWSHeaderParameters,
  type JSONWebKeySet,
} from "jose";

export type SafeJwtAlgorithm = "RS256" | "PS256" | "ES256" | "EdDSA";
const SAFE_ASYMMETRIC_ALGORITHMS: readonly SafeJwtAlgorithm[] = [
  "RS256",
  "PS256",
  "ES256",
  "EdDSA",
];

export interface AuthyonJwtClaims extends JWTPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  email?: string;
  username?: string;
  roles?: string[];
  permissions?: string[];
  scope?: string;
}

export interface VerifiedAccessToken {
  claims: AuthyonJwtClaims;
  protectedHeader: JWSHeaderParameters;
}

export interface JwksTokenVerifierOptions {
  /** Exact trusted issuer from Authyon OpenID discovery. */
  issuer: string;
  /** Audience assigned to the API consuming this token. */
  audience: string | string[];
  /** Trusted HTTPS JWKS endpoint. Never derive this value from the token header. */
  jwksUri?: string;
  /** Static trusted keys for pinned or offline verification. */
  jwks?: JSONWebKeySet;
  algorithms?: readonly SafeJwtAlgorithm[];
  acceptedTokenTypes?: readonly string[];
  clockToleranceSeconds?: number;
  maxTokenAgeSeconds?: number;
  jwksTimeoutMs?: number;
  jwksCacheMs?: number;
  jwksCooldownMs?: number;
}

export interface AuthyonJwksDiscoveryOptions extends Omit<
  JwksTokenVerifierOptions,
  "issuer" | "jwksUri" | "jwks"
> {
  /** Optional pin; discovery fails if Authyon advertises a different issuer. */
  issuer?: string;
  /** Override the client environment key used by the discovery endpoint. */
  publishableKey?: string;
}

export type TokenVerificationErrorCode =
  | "token.invalid"
  | "token.expired"
  | "token.not_active"
  | "token.invalid_claims"
  | "token.invalid_signature"
  | "token.key_unavailable";

export class TokenVerificationError extends Error {
  constructor(
    readonly code: TokenVerificationErrorCode,
    options: { cause?: unknown } = {},
  ) {
    super(messageForCode(code));
    this.name = "TokenVerificationError";
    if (options.cause !== undefined) Object.defineProperty(this, "cause", { value: options.cause });
  }
}

/** Secure, cached JWT signature and claims verifier backed by a trusted remote JWKS. */
export class JwksTokenVerifier {
  private readonly verifyKey:
    ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet>;
  private readonly algorithms: SafeJwtAlgorithm[];
  private readonly acceptedTokenTypes: Set<string>;

  constructor(private readonly options: JwksTokenVerifierOptions) {
    validateOptions(options);
    this.algorithms = [...(options.algorithms ?? ["RS256"])] as SafeJwtAlgorithm[];
    this.acceptedTokenTypes = new Set(options.acceptedTokenTypes ?? ["JWT", "at+jwt"]);
    this.verifyKey = options.jwks
      ? createLocalJWKSet(options.jwks)
      : createRemoteJWKSet(new URL(options.jwksUri!), {
          timeoutDuration: options.jwksTimeoutMs ?? 5_000,
          cacheMaxAge: options.jwksCacheMs ?? 600_000,
          cooldownDuration: options.jwksCooldownMs ?? 30_000,
        });
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    if (!token || token.length > 16_384) {
      throw new TokenVerificationError("token.invalid");
    }
    try {
      const result = await jwtVerify<AuthyonJwtClaims>(token, this.verifyKey, {
        algorithms: this.algorithms,
        issuer: this.options.issuer,
        audience: this.options.audience,
        clockTolerance: this.options.clockToleranceSeconds ?? 5,
        maxTokenAge: this.options.maxTokenAgeSeconds ?? 3_600,
        requiredClaims: ["iss", "aud", "sub", "exp", "iat"],
      });
      validateTokenType(result, this.acceptedTokenTypes);
      validateClaims(result.payload);
      return { claims: result.payload, protectedHeader: result.protectedHeader };
    } catch (cause) {
      if (cause instanceof TokenVerificationError) throw cause;
      throw new TokenVerificationError(errorCode(cause), { cause });
    }
  }
}

function validateTokenType(
  result: JWTVerifyResult<AuthyonJwtClaims>,
  acceptedTokenTypes: Set<string>,
): void {
  const type = result.protectedHeader.typ;
  if (!type || !acceptedTokenTypes.has(type)) {
    throw new TokenVerificationError("token.invalid_claims");
  }
}

function validateClaims(claims: AuthyonJwtClaims): void {
  if (typeof claims.sub !== "string" || !claims.sub) invalidClaims();
  if (claims.permissions !== undefined && !isStringArray(claims.permissions)) invalidClaims();
  if (claims.roles !== undefined && !isStringArray(claims.roles)) invalidClaims();
  if (claims.scope !== undefined && typeof claims.scope !== "string") invalidClaims();
}

function validateOptions(options: JwksTokenVerifierOptions): void {
  const issuer = secureUrl(options.issuer, "issuer");
  if (Boolean(options.jwksUri) === Boolean(options.jwks)) {
    throw new Error("Authyon: configure exactly one of `jwksUri` or `jwks`");
  }
  const jwks = options.jwksUri ? secureUrl(options.jwksUri, "jwksUri") : undefined;
  if (!options.audience || (Array.isArray(options.audience) && options.audience.length === 0)) {
    throw new Error("Authyon: JWT `audience` is required");
  }
  if (jwks && issuer.origin !== jwks.origin) {
    throw new Error("Authyon: `issuer` and `jwksUri` must use the same trusted origin");
  }
  const algorithms = options.algorithms ?? ["RS256"];
  if (
    algorithms.length === 0 ||
    algorithms.some((algorithm) => !SAFE_ASYMMETRIC_ALGORITHMS.includes(algorithm))
  ) {
    throw new Error("Authyon: only approved asymmetric JWT algorithms are accepted");
  }
  if (
    options.acceptedTokenTypes?.length === 0 ||
    options.acceptedTokenTypes?.some((type) => !type.trim())
  ) {
    throw new Error("Authyon: `acceptedTokenTypes` must contain non-empty values");
  }
  for (const [name, value] of [
    ["clockToleranceSeconds", options.clockToleranceSeconds],
    ["maxTokenAgeSeconds", options.maxTokenAgeSeconds],
    ["jwksTimeoutMs", options.jwksTimeoutMs],
    ["jwksCacheMs", options.jwksCacheMs],
    ["jwksCooldownMs", options.jwksCooldownMs],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Authyon: \`${name}\` must be a non-negative finite number`);
    }
  }
}

function secureUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Authyon: JWT \`${name}\` must be an absolute URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`Authyon: JWT \`${name}\` must be a credential-free HTTPS URL`);
  }
  return url;
}

function errorCode(error: unknown): TokenVerificationErrorCode {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "ERR_JWT_EXPIRED") return "token.expired";
  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") return "token.invalid_signature";
  if (code === "ERR_JWKS_TIMEOUT") {
    return "token.key_unavailable";
  }
  if (code === "ERR_JWKS_NO_MATCHING_KEY") return "token.invalid_signature";
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    const claim = isRecord(error) && typeof error.claim === "string" ? error.claim : "";
    return claim === "nbf" ? "token.not_active" : "token.invalid_claims";
  }
  return "token.invalid";
}

function messageForCode(code: TokenVerificationErrorCode): string {
  if (code === "token.key_unavailable") return "Token verification key is unavailable";
  if (code === "token.expired") return "Token has expired";
  if (code === "token.not_active") return "Token is not active yet";
  return "Token verification failed";
}

function invalidClaims(): never {
  throw new TokenVerificationError("token.invalid_claims");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
