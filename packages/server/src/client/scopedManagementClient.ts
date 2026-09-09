import type { JsonRequestOptions } from "../../../../internal/core/http/jsonHttpClient";
import type {
  AccessTokenSource,
  AcceptWorkspaceInviteInput,
  CredentialDetail,
  CredentialListOptions,
  CredentialPermissionsInput,
  CredentialScope,
  CreateCredentialInput,
  InviteTenantMemberInput,
  InviteWorkspaceMemberInput,
  TenantManagementScope,
  TenantMember,
  TenantMemberPage,
  WorkspaceInviteAccepted,
  WorkspaceInviteIssued,
  WorkspaceInvitePreview,
  WorkspaceRole,
  WorkspaceTeam,
} from "../contracts/management";
import type {
  EnvironmentUser,
  PaginationOptions,
  TenantCredentialIssued,
} from "../contracts/server";
import {
  credentialDetail,
  credentialPage,
  permissionsBody,
  lifetimeBody,
  segment,
  type ManagementRequest,
} from "./credentialManagement";

function scopedRequest(request: ManagementRequest, source: AccessTokenSource): ManagementRequest {
  return async <T>(path: string, options: JsonRequestOptions = {}): Promise<T> => {
    const token = typeof source === "function" ? await source() : source;
    if (typeof token !== "string" || !token.trim() || /\s/u.test(token))
      throw new TypeError("Authyon: a valid access token is required.");
    return request<T>(path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });
  };
}
function environmentPath(scope: CredentialScope): string {
  return `/platform/workspaces/${segment(scope.workspaceId)}/environments/${segment(scope.environmentId)}`;
}
function tenantPath(scope: TenantManagementScope): string {
  return `${environmentPath(scope)}/tenants/${segment(scope.tenantId)}`;
}
function credentialPath(scope: CredentialScope): string {
  return `${scope.tenantId === undefined ? environmentPath(scope) : tenantPath(scope as TenantManagementScope)}/credentials`;
}
function workspacePath(id: string): string {
  return `/platform/workspaces/${segment(id)}`;
}
function workspaceRole(role: WorkspaceRole): WorkspaceRole {
  if (role !== "admin" && role !== "auditor")
    throw new TypeError("Authyon: workspace role must be admin or auditor.");
  return role;
}

/** Platform user administration. Never falls back to an environment machine token. */
export class PlatformScopedClient {
  #request: ManagementRequest;
  /** @hidden */
  constructor(request: ManagementRequest, token: AccessTokenSource) {
    this.#request = scopedRequest(request, token);
  }
  readonly credentials = {
    list: (scope: CredentialScope, options: CredentialListOptions = {}) =>
      credentialPage(this.#request, credentialPath(scope), options),
    get: async (scope: CredentialScope, credentialId: string): Promise<CredentialDetail> =>
      credentialDetail(await this.#request(`${credentialPath(scope)}/${segment(credentialId)}`)),
    create: (
      scope: CredentialScope,
      input: CreateCredentialInput,
    ): Promise<TenantCredentialIssued> =>
      this.#request(credentialPath(scope), {
        method: "POST",
        body: { description: input.description, ...lifetimeBody(input), ...permissionsBody(input) },
      }),
    updatePermissions: (
      scope: CredentialScope,
      credentialId: string,
      input: CredentialPermissionsInput,
    ): Promise<void> =>
      this.#request(`${credentialPath(scope)}/${segment(credentialId)}/permissions`, {
        method: "PUT",
        body: permissionsBody(input),
      }),
    updateScopes: (
      scope: CredentialScope,
      credentialId: string,
      scopes: readonly string[],
    ): Promise<void> => this.credentials.updatePermissions(scope, credentialId, { scopes }),
    /** Returns a new secret once. API may require an explicit step-up first. */
    rotate: (scope: CredentialScope, credentialId: string): Promise<TenantCredentialIssued> =>
      this.#request(`${credentialPath(scope)}/${segment(credentialId)}/rotate`, { method: "POST" }),
    revoke: (scope: CredentialScope, credentialId: string): Promise<void> =>
      this.#request(`${credentialPath(scope)}/${segment(credentialId)}`, { method: "DELETE" }),
  };
  readonly workspaces = {
    team: (workspaceId: string): Promise<WorkspaceTeam> =>
      this.#request(`${workspacePath(workspaceId)}/team`),
    members: {
      invite: (
        workspaceId: string,
        input: InviteWorkspaceMemberInput,
      ): Promise<WorkspaceInviteIssued> =>
        this.#request(`${workspacePath(workspaceId)}/invites`, {
          method: "POST",
          body: { email: input.email, role: workspaceRole(input.role) },
        }),
      /** memberId comes from team.members; it is not the platform userId. */
      remove: (workspaceId: string, memberId: string): Promise<void> =>
        this.#request(`${workspacePath(workspaceId)}/members/${segment(memberId)}`, {
          method: "DELETE",
        }),
      changeRole: (workspaceId: string, memberId: string, role: WorkspaceRole): Promise<void> =>
        this.#request(`${workspacePath(workspaceId)}/members/${segment(memberId)}`, {
          method: "PATCH",
          body: { role: workspaceRole(role) },
        }),
    },
    invites: {
      create: (
        workspaceId: string,
        input: InviteWorkspaceMemberInput,
      ): Promise<WorkspaceInviteIssued> => this.workspaces.members.invite(workspaceId, input),
      revoke: (workspaceId: string, inviteId: string): Promise<void> =>
        this.#request(`${workspacePath(workspaceId)}/invites/${segment(inviteId)}`, {
          method: "DELETE",
        }),
    },
  };
  readonly tenants = {
    members: {
      list: (
        scope: TenantManagementScope,
        options: PaginationOptions = {},
      ): Promise<EnvironmentUser[]> =>
        this.#request(`${tenantPath(scope)}/members`, { query: options }),
      add: (scope: TenantManagementScope, userId: string, roles?: string[]): Promise<void> =>
        this.#request(`${tenantPath(scope)}/members`, { method: "POST", body: { userId, roles } }),
      remove: (scope: TenantManagementScope, userId: string): Promise<void> =>
        this.#request(`${tenantPath(scope)}/members/${segment(userId)}`, { method: "DELETE" }),
    },
  };
  readonly auth = {
    /** Explicitly confirms the current platform session; passwords are not retained. */
    stepUp: (currentPassword: string): Promise<void> =>
      this.#request("/platform/auth/step-up", { method: "POST", body: { currentPassword } }),
  };
}

/** End-user operations require a user token and the environment publishable key. */
export class UserScopedClient {
  #request: ManagementRequest;
  /** @hidden */
  constructor(request: ManagementRequest, token: AccessTokenSource) {
    this.#request = scopedRequest(request, token);
  }
  readonly tenants = {
    members: {
      list: (tenantId: string, options: PaginationOptions = {}): Promise<TenantMemberPage> =>
        this.#request(`/auth/tenants/${segment(tenantId)}/members`, { query: options }),
      /** Adds an existing environment user by email; does not send an invitation email. */
      invite: (tenantId: string, input: InviteTenantMemberInput): Promise<TenantMember> =>
        this.#request(`/auth/tenants/${segment(tenantId)}/members`, {
          method: "POST",
          body: { email: input.email, roles: input.roles },
        }),
      remove: (tenantId: string, userId: string): Promise<void> =>
        this.#request(`/auth/tenants/${segment(tenantId)}/members/${segment(userId)}`, {
          method: "DELETE",
        }),
    },
  };
}

/** Anonymous invite endpoints: the invitation token itself authorizes these requests. */
export class WorkspaceInvitesClient {
  #request: ManagementRequest;
  /** @hidden */
  constructor(request: ManagementRequest) {
    this.#request = request;
  }
  preview(token: string): Promise<WorkspaceInvitePreview> {
    return this.#request(`/platform/workspace-invites/${segment(token)}`);
  }
  accept(token: string, input: AcceptWorkspaceInviteInput = {}): Promise<WorkspaceInviteAccepted> {
    return this.#request(`/platform/workspace-invites/${segment(token)}/accept`, {
      method: "POST",
      body: { name: input.name, password: input.password },
    });
  }
}
