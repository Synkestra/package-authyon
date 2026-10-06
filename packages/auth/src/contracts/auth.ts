import type { SecurityMethods } from "../../../../internal/core/contracts/security";
/**
 * Organization membership (the Authyon API calls this a "tenant" on the
 * wire — the SDK exposes it as "organization").
 */
export interface Organization {
  id: string;
  slug: string;
  name?: string;
  description?: string;
  roles?: string[];
  /** JSON-encoded values for the organization's configured custom fields. */
  customFields?: string;
  /** JSON-encoded metadata visible to members of the organization. */
  publicMetadata?: string;
}

/** POST /auth/tenants — creates an organization owned by the signed-in user. */
export interface CreateOrganizationInput {
  name?: string;
  slug?: string;
  description?: string;
  customFields?: Record<string, unknown>;
}

/** GET /auth/tenants/{organizationId}/members — confirmed against the live API. */
export interface OrganizationMember {
  userId: string;
  email?: string;
  username?: string;
  roles?: string[];
  createdAt?: string;
  lastLoginAt?: string | null;
}

/** POST /auth/tenants/{tenantId}/members — invites a member by e-mail. */
export interface InviteMemberInput {
  email: string;
  roles: string[];
}

/**
 * POST /auth/tenants/{organizationId}/invites — invite an address that may not
 * have an account yet; accepting creates it. `sendEmail` defaults to `true`;
 * `false` only returns the link, for delivery through your own channel.
 */
export interface OrganizationInviteInput {
  email: string;
  roles?: string[];
  sendEmail?: boolean;
  /**
   * Where to send the invitee after they accept. Must be registered exactly in
   * the environment's redirect URIs (the same list SSO and magic link use);
   * otherwise the API rejects the invite. Comes back on `preview` and `accept`.
   */
  redirectUri?: string;
}

/** Returned when an invite is created or re-issued. `acceptUrl` is only ever
 *  readable here — the API keeps a hash of the token, not the token. */
export interface OrganizationInviteIssued {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  acceptUrl: string;
  expiresAt: string;
  emailSent: boolean;
  redirectUri: string | null;
}

export type OrganizationInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface OrganizationInvite {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  status: OrganizationInviteStatus;
  createdAt: string;
  expiresAt: string;
  emailSentAt: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  revokedAt: string | null;
  invitedByUserId: string | null;
  redirectUri: string | null;
}

/** POST /auth/tenant-invites/preview — what an accept page shows before the invitee commits. */
export interface OrganizationInvitePreview {
  tenantId: string;
  tenantName: string;
  email: string;
  roles: string[];
  expiresAt: string;
  /** True: accepting only needs the token. False: send a password (and a username when `usernameRequired`). */
  accountExists: boolean;
  usernameRequired: boolean;
  /** Where the issuer asked to send the invitee after accepting, or `null`. */
  redirectUri: string | null;
}

/** POST /auth/tenant-invites/accept — everything but `token` is ignored when the address already has an account. */
export interface AcceptOrganizationInviteInput {
  token: string;
  username?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  /**
   * @deprecated Use `publicMetadata` / `privateMetadata` through
   * `@authyon/server` (`environment.tenants.invites.accept`), which runs on
   * your backend with the environment credential. Still accepted for now.
   */
  customFields?: Record<string, unknown>;
}

export interface OrganizationInviteAccepted {
  tenantId: string;
  tenantName: string;
  userId: string;
  /** True when accepting created the account (email already confirmed). The invitee still signs in normally. */
  accountCreated: boolean;
  /** Where the issuer asked to send the invitee, or `null`. Redirecting is up to the accept page. */
  redirectUri: string | null;
}

/** Authenticated user profile. */
export interface User {
  id: string;
  email: string;
  username?: string;
  emailConfirmed?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  roles?: string[];
  permissions?: string[];
  createdAt?: string;
  lastLoginAt?: string;
  organizations?: Organization[];
  activeOrganization?: Organization | null;
  /** Actions the user must complete before continuing (e.g. confirm e-mail). */
  pendencies?: string[];
  /** Security methods active on the account (authenticator, email code, passkey, SSO…). */
  security?: SecurityMethods;
}

/** Token pair issued by login / refresh / tenant switch. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (typically 1800). */
  expiresIn: number;
  /** Epoch ms when the access token expires (computed client-side). */
  expiresAt: number;
  user?: User;
}

export type TwoFactorMethod = "authenticator" | "email" | "webauthn" | string;

/** Returned by `login()` when the account has 2FA enabled. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
  methods: TwoFactorMethod[];
  emailHint?: string;
}

export type LoginResult = { twoFactorRequired: false; session: Session } | TwoFactorChallenge;

export interface RegisterInput {
  email: string;
  username?: string;
  password: string;
  /** Values for custom user fields configured in the environment. */
  customFields?: Record<string, unknown>;
}

export interface LoginInput {
  /** Provide `email` or `username`. */
  email?: string;
  username?: string;
  password: string;
  /** Optional organization to scope the session to (sent as `tenantSlug`). */
  organizationSlug?: string;
}

/** A completed WebAuthn ceremony, handed back to the server to finish login/registration. */
export interface WebAuthnAssertion {
  ceremonyToken: string;
  /** JSON-serialized `PublicKeyCredential` returned by `navigator.credentials.get()`. */
  assertionJson: string;
}

/** POST /auth/2fa/verify — redeems a challenge from `login()`. */
export interface VerifyTwoFactorInput {
  challengeToken: string;
  method: TwoFactorMethod;
  /** TOTP / email / recovery code. Omit when `method` is `"webauthn"`. */
  code?: string;
  /** Required when `method` is `"webauthn"`. */
  webAuthnAssertion?: WebAuthnAssertion;
}

/** GET /auth/2fa/status — per-method enrolment flags, confirmed against the live API. */
export interface TwoFactorStatus {
  authenticatorEnabled: boolean;
  authenticatorConfirmedAt?: string | null;
  emailEnabled: boolean;
  emailEnabledAt?: string | null;
  /** Partially redacted (e.g. `"n**********@h***.com"`). */
  emailHint?: string | null;
  webAuthnEnabled: boolean;
  webAuthnCredentialCount: number;
  webAuthnCredentials: WebAuthnCredential[];
  remainingRecoveryCodes: number;
}

export interface AuthenticatorSetup {
  secret: string;
  qrSvg: string;
  otpauthUri: string;
}

/**
 * Options handed back by a WebAuthn "start" endpoint: a ceremony token to
 * correlate the "finish" call, plus the WebAuthn options object to pass into
 * `navigator.credentials.get()` / `.create()` (after `JSON.parse`, per the
 * WebAuthn spec — challenge/user.id are base64url strings on the wire).
 *
 * ⚠️ The exact shape of `options` is not published in the OpenAPI schema (no
 * response bodies are documented for any endpoint at the time this SDK was
 * written) — treat it as opaque input to the WebAuthn API.
 */
export interface WebAuthnCeremonyStart {
  ceremonyToken: string;
  options: unknown;
}

export interface WebAuthnCredential {
  id: string;
  nickname?: string;
  createdAt?: string;
}

export interface SsoProvider {
  name: string;
  slug: string;
  /** URL to redirect the browser to in order to start this provider's flow. */
  startUrl: string;
}

/** GET /auth/me/activities — one audit-trail entry, confirmed against the live API. */
export interface Activity {
  id: string;
  eventType: string;
  occurredAt: string;
  environmentId?: string;
  ip?: string;
  userAgent?: string;
  /** JSON-encoded string — `JSON.parse` it for the event-specific payload. */
  payloadJson?: string;
}

/** A role available within an organization (tenant). */
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
}

/** GET /auth/sessions — confirmed against the live API. */
export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  createdFromIp?: string;
  isActive: boolean;
  userAgent?: string;
  lastUsedAt?: string | null;
  lastUsedFromIp?: string | null;
}

/**
 * POST /auth/validate — confirmed against the live API. The wire shape is
 * `{ valid, reason, profile }`, not `{ user, organization }` as the
 * OpenAPI schema (which didn't document response bodies) suggested.
 * `profile` is `null` for machine tokens (there's no user behind them) and
 * for tokens that fail validation.
 */
export interface ValidateResult {
  valid: boolean;
  reason?: string | null;
  user: User | null;
}

export type AuthEvent =
  | { type: "signed_in"; session: Session }
  | { type: "refreshed"; session: Session }
  | { type: "session_validated"; session: Session }
  | { type: "signed_out" };

export type AuthStateListener = (event: AuthEvent) => void;

/** Pluggable persistence for the token pair. */
export interface TokenStorage {
  get(): Session | null;
  set(session: Session): void;
  clear(): void;
}

export type AuthState = "signed_out" | "authenticated" | "expired";

export interface AuthyonClientOptions {
  /** Publishable environment key (`pk_live_...` / `pk_test_...`). */
  envKey: string;
  /**
   * Originating client IP to forward on every API call as `X-Forwarded-For`.
   * Browsers cannot reliably discover their public IP by themselves; set this
   * only when your application receives it from trusted infrastructure.
   */
  clientIp?: string;
  /** API origin. Defaults to `https://api.authyon.com`; HTTPS is required outside loopback. */
  baseUrl?: string;
  /** Allow an HTTP `baseUrl`. Intended only for explicitly trusted local development. */
  allowInsecureHttp?: boolean;
  /** Where tokens are persisted. Defaults to memory; persistent storage is explicit opt-in. */
  storage?: TokenStorage;
  /**
   * Automatically refresh the access token shortly before it expires and
   * retry once on 401. Defaults to `true`.
   */
  autoRefresh?: boolean;
  /** Maximum duration of each HTTP request. Defaults to 15 seconds; set to `0` to disable. */
  timeoutMs?: number;
  /** Custom HTTP adapter for tracing, mocks or an alternative HTTP stack. */
  httpAdapter?: HttpAdapter;
  /** Safe HTTP lifecycle logging. Disabled unless this option is provided with `enabled: true`. */
  httpLogger?: HttpLoggerOptions;
  /** @deprecated Prefer `httpAdapter: new FetchHttpAdapter(customFetch)`. */
  fetch?: typeof fetch;
}
import type { HttpAdapter, HttpLoggerOptions } from "../../../../internal/core/http/httpAdapter";
export type {
  IntrospectResult,
  Paged,
  PaginationOptions,
} from "../../../../internal/core/contracts/common";
export type {
  Approval,
  ApprovalAssurance,
  ApprovalPayload,
  ApprovalStatus,
  ApprovalWebAuthnOptions,
  ConfirmApprovalInput,
  SecurityMethods,
} from "../../../../internal/core/contracts/security";
