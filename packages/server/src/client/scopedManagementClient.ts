import type { JsonRequestOptions } from "../../../../internal/core/http/jsonHttpClient";
import type {
  AccessTokenSource,
  InviteTenantMemberInput,
  TenantMember,
  TenantMemberPage,
} from "../contracts/management";
import type { PaginationOptions } from "../contracts/server";
import { segment, type ManagementRequest } from "./credentialManagement";
import { subjectFinancialAuthorizations } from "../../../../internal/core/financial/subjectFinancialAuthorizations";

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
    this.financialAuthorizations = subjectFinancialAuthorizations(this.#request);
  }
  /**
   * Customer-side approval of a financial authorization, for backends (BFF)
   * that hold the customer's access token: `get`, `webauthnOptions`,
   * `confirm`, `reject`.
   */
  readonly financialAuthorizations: ReturnType<typeof subjectFinancialAuthorizations>;
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
