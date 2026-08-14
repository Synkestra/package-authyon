/** Tenant membership as returned by the Authyon API. */
export interface Tenant {
  id: string;
  slug: string;
  name?: string;
  roles?: string[];
}

/** Authenticated user profile. */
export interface User {
  id: string;
  email: string;
  username?: string;
  tenants?: Tenant[];
  activeTenant?: Tenant | null;
  permissions?: string[];
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

export type TwoFactorMethod = "authenticator" | "email" | string;

/** Returned by `login()` when the account has 2FA enabled. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeId: string;
  methods: TwoFactorMethod[];
  emailHint?: string;
}

export type LoginResult =
  | { twoFactorRequired: false; session: Session }
  | TwoFactorChallenge;

export interface RegisterParams {
  email: string;
  username?: string;
  password: string;
}

export interface LoginParams {
  /** Provide `email` or `username`. */
  email?: string;
  username?: string;
  password: string;
  /** Optional tenant to scope the session to. */
  tenantSlug?: string;
}

export interface TwoFactorChallengeParams {
  challengeId: string;
  method?: TwoFactorMethod;
  /** TOTP / email code. */
  code?: string;
  /** Single-use recovery code (alternative to `code`). */
  recoveryCode?: string;
}

export interface TwoFactorStatus {
  methods: TwoFactorMethod[];
  recoveryCodesRemaining?: number;
}

export interface AuthenticatorSetup {
  secret: string;
  qrSvg: string;
  otpauthUri: string;
}

export interface SessionInfo {
  id: string;
  createdAt?: string;
  lastUsedAt?: string;
  ip?: string;
  device?: string;
  current?: boolean;
}

export interface IntrospectResult {
  active: boolean;
  sub?: string;
  exp?: number;
  scope?: string;
}

export interface ValidateResult {
  user: User;
  tenant?: Tenant | null;
}

export type AuthEvent =
  | { type: "signed_in"; session: Session }
  | { type: "refreshed"; session: Session }
  | { type: "signed_out" };

export type AuthStateListener = (event: AuthEvent) => void;

/** Pluggable persistence for the token pair. */
export interface TokenStorage {
  get(): Session | null;
  set(session: Session): void;
  clear(): void;
}

export interface AuthyonClientOptions {
  /** Publishable environment key (`pk_live_...` / `pk_test_...`). */
  envKey: string;
  /** API origin. Defaults to `https://api.authyon.com`. */
  baseUrl?: string;
  /** Where tokens are persisted. Defaults to localStorage when available, memory otherwise. */
  storage?: TokenStorage;
  /**
   * Automatically refresh the access token shortly before it expires and
   * retry once on 401. Defaults to `true`.
   */
  autoRefresh?: boolean;
  /** Custom fetch implementation (useful for tests / non-browser runtimes). */
  fetch?: typeof fetch;
}
