import type { JsonRequestOptions } from "../../../../internal/core/http/jsonHttpClient";
import type {
  AccessTokenSource,
  InviteTenantMemberInput,
  TenantInvite,
  TenantInviteInput,
  TenantInviteIssued,
  TenantMember,
  TenantMemberPage,
} from "../contracts/management";
import type { PaginationOptions } from "../contracts/server";
import { segment, type ManagementRequest } from "./credentialManagement";
import {
  subjectSecurity,
  type SubjectSecurity,
} from "../../../../internal/core/security/approvals";

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
/** End-user operations require a user token and the environment publishable key. */
export class UserScopedClient {
  #request: ManagementRequest;
  /** @hidden */
  constructor(request: ManagementRequest, token: AccessTokenSource) {
    this.#request = scopedRequest(request, token);
    this.security = subjectSecurity(this.#request);
  }
  /**
   * The customer's side of `security.approvals`, for backends (BFF) that hold
   * the customer's access token: `get`, `webauthnOptions`, `confirm`, `reject`.
   */
  readonly security: SubjectSecurity;
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
    /**
     * Invites by e-mail or by link, acting as the user. Requires the
     * `tenants:members:invite` permission on the tenant.
     */
    invites: {
      list: (tenantId: string): Promise<TenantInvite[]> =>
        this.#request(`/auth/tenants/${segment(tenantId)}/invites`),
      /** Always returns `acceptUrl`; `sendEmail: false` skips the e-mail. */
      create: (tenantId: string, input: TenantInviteInput): Promise<TenantInviteIssued> =>
        this.#request(`/auth/tenants/${segment(tenantId)}/invites`, {
          method: "POST",
          body: { email: input.email, roles: input.roles, sendEmail: input.sendEmail ?? true },
        }),
      /** New link (the previous one stops working), mailed unless `sendEmail` is `false`. */
      resend: (
        tenantId: string,
        inviteId: string,
        input: { sendEmail?: boolean } = {},
      ): Promise<TenantInviteIssued> =>
        this.#request(`/auth/tenants/${segment(tenantId)}/invites/${segment(inviteId)}/resend`, {
          method: "POST",
          body: { sendEmail: input.sendEmail ?? true },
        }),
      revoke: (tenantId: string, inviteId: string): Promise<void> =>
        this.#request(`/auth/tenants/${segment(tenantId)}/invites/${segment(inviteId)}`, {
          method: "DELETE",
        }),
    },
  };
}
