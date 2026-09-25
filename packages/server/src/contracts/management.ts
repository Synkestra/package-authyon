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
