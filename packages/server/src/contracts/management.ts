import type { Paged, PaginationOptions, TenantCredentialSummary } from "./server";

/** A token of the requested authentication plane, or a provider called for each request. */
export type AccessTokenSource = string | (() => string | Promise<string>);
export interface CredentialListOptions extends PaginationOptions {
  search?: string;
}
/** scopes is an alias for permissions. Always supply an explicit, nonempty set. */
export type CredentialPermissionsInput =
  | { permissions: readonly string[]; scopes?: never }
  | { scopes: readonly string[]; permissions?: never };
export type CreateCredentialInput = CredentialPermissionsInput & {
  description?: string;
  lifetimeDays?: number | null;
};
export interface CredentialCreator {
  id: string | null;
  type: string;
  displayName: string | null;
}
export interface CredentialDetail extends TenantCredentialSummary {
  createdBy: CredentialCreator | null;
  updatedAt: string | null;
  secretRotatedAt: string | null;
  expiresAt: string | null;
  ageSeconds: number;
  /** Null while active; elapsed lifetime at revocation otherwise. */
  lifetimeSeconds: number | null;
  accessTokenLifetimeSeconds: number;
}
export interface InviteTenantMemberInput {
  email: string;
  roles?: string[];
}
export interface TenantMember {
  userId: string;
  email: string;
  username: string;
  roles: string[];
  createdAt: string;
  lastLoginAt: string | null;
}
export type TenantMemberPage = Paged<TenantMember>;

/**
 * Invite an address to a tenant. The address may not have an account in the
 * environment yet — accepting creates it. `sendEmail` defaults to `true`;
 * `false` only returns the link, for delivery through your own channel.
 */
export interface TenantInviteInput {
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
export interface TenantInviteIssued {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  acceptUrl: string;
  expiresAt: string;
  emailSent: boolean;
  redirectUri: string | null;
}
export type TenantInviteStatus = "pending" | "accepted" | "revoked" | "expired";
export interface TenantInvite {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  status: TenantInviteStatus;
  createdAt: string;
  expiresAt: string;
  emailSentAt: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  revokedAt: string | null;
  invitedByUserId: string | null;
  redirectUri: string | null;
}
/** What an accept page shows before the invitee commits. */
export interface TenantInvitePreview {
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
/** Redeem an invite. Everything but `token` is ignored when the address already has an account. */
export interface AcceptTenantInviteInput {
  token: string;
  username?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  customFields?: Record<string, unknown>;
}
export interface TenantInviteAccepted {
  tenantId: string;
  tenantName: string;
  userId: string;
  accountCreated: boolean;
  /** Where the issuer asked to send the invitee, or `null`. Redirecting is up to the accept page. */
  redirectUri: string | null;
}
