export interface Organization {
  id: string;
  slug: string;
  name?: string;
}

export interface User {
  id: string;
  email: string;
  username?: string;
  permissions?: string[];
}

export interface IntrospectResult {
  active: boolean;
  sub?: string;
  exp?: number;
  scope?: string;
}

export interface ValidateResult {
  user: User;
  organization?: Organization | null;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

/** Role/scope granted to a member within an organization. */
export interface MemberInput {
  /** e.g. "owner", "admin", "member". */
  role: string;
  /** Fine-grained permissions, if you need more granularity than `role`. */
  scopes?: string[];
}

export interface Member {
  userId: string;
  role: string;
  scopes?: string[];
}

export interface InviteInput extends MemberInput {
  email: string;
}

export interface Invite {
  inviteId: string;
}

export interface AuthyonServerClientOptions {
  /**
   * Publishable environment key (`pk_live_...` / `pk_test_...`). Required
   * for `introspect()` / `validate()` — the same key your frontend uses.
   */
  envKey?: string;
  /**
   * Secret key (`sk_live_...` / `sk_test_...`). Required for organization
   * and member management. NEVER expose this to the browser.
   */
  secretKey?: string;
  /** API origin. Defaults to `https://api.authyon.com`. */
  baseUrl?: string;
  /** Custom fetch implementation (useful for tests / edge runtimes). */
  fetch?: typeof fetch;
}
