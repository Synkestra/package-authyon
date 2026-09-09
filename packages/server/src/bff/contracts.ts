import type { LoginInput, VerifyTwoFactorInput } from "../../../auth/src/contracts/auth";

export type { LoginInput, VerifyTwoFactorInput };

export interface BffTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Explicit public projection; upstream objects must never be spread into responses. */
export interface BffUser {
  id: string;
  email: string;
  organization: { id: string; slug: string } | null;
}

export interface BffChallenge {
  twoFactorRequired: true;
  challengeToken: string;
  methods: string[];
}

export interface BffAuthProvider {
  login(input: LoginInput): Promise<BffTokens | BffChallenge>;
  verifyTwoFactor(input: VerifyTwoFactorInput): Promise<BffTokens>;
  refresh(refreshToken: string): Promise<BffTokens>;
  logout(refreshToken: string): Promise<void>;
  switchOrganization(accessToken: string, slug: string): Promise<BffTokens>;
  validate(accessToken: string): Promise<boolean>;
  profile(accessToken: string): Promise<BffUser>;
}

export interface BffSessionRecord {
  revision: string;
  tokens: BffTokens;
  user: BffUser;
  expiresAt: number;
  idleExpiresAt: number;
  /** A crashed token rotation must invalidate the session, never replay its old token. */
  busyUntil: number | null;
}

export interface BffSessionStore {
  read(key: string): Promise<BffSessionRecord | null>;
  /** Atomic across all processes. null expectedRevision means insert only if absent. */
  compareAndSwap(
    key: string,
    expectedRevision: string | null,
    next: BffSessionRecord | null,
  ): Promise<boolean>;
}

export interface BffSessionOptions {
  origin: string;
  provider: BffAuthProvider;
  store: BffSessionStore;
  absoluteTimeoutMs?: number;
  idleTimeoutMs?: number;
  refreshAheadMs?: number;
  /** Only permits HTTP on localhost/loopback. Never enables remote HTTP. */
  allowInsecureLocalhost?: boolean;
}

export class BffSessionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly clearCookie = false,
  ) {
    super(code);
    this.name = "BffSessionError";
  }
}
