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
export type CreateCredentialInput = CredentialPermissionsInput & { description?: string; lifetimeDays?: number | null };
export interface CredentialScope {
  workspaceId: string;
  environmentId: string;
  tenantId?: string;
}
export interface TenantManagementScope extends CredentialScope {
  tenantId: string;
}
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
export type WorkspaceRole = "admin" | "auditor";
export interface WorkspaceMember {
  memberId: string | null;
  userId: string;
  email: string;
  name: string;
  role: string;
  isOwner: boolean;
  isSelf: boolean;
  invitedByName: string | null;
  joinedAt: string;
  lastLoginAt: string | null;
}
export interface WorkspaceInvite {
  id: string;
  email: string;
  role: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
}
export interface WorkspaceTeam {
  workspaceId: string;
  workspaceName: string;
  callerRole: string;
  canManage: boolean;
  members: WorkspaceMember[];
  pendingInvites: WorkspaceInvite[];
}
export interface InviteWorkspaceMemberInput {
  email: string;
  role: WorkspaceRole;
}
export interface WorkspaceInviteIssued {
  inviteId: string;
  email: string;
  role: string;
  /** Sensitive bearer link returned at issuance. Do not log or persist in public storage. */
  acceptUrl: string;
  expiresAt: string;
}
export interface WorkspaceInvitePreview {
  workspaceName: string;
  email: string;
  role: string;
  expiresAt: string;
  requiresRegistration: boolean;
}
export interface WorkspaceInviteAccepted {
  workspaceId: string;
  workspaceName: string;
  role: string;
  accountCreated: boolean;
}
export interface AcceptWorkspaceInviteInput {
  name?: string;
  password?: string;
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

