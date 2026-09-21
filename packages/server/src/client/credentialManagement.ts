import type { JsonRequestOptions } from "../../../../internal/core/http/jsonHttpClient";
import type {
  CredentialDetail,
  CredentialListOptions,
  CredentialPermissionsInput,
} from "../contracts/management";
import type { Paged, TenantCredentialSummary } from "../contracts/server";

export type ManagementRequest = <T>(path: string, options?: JsonRequestOptions) => Promise<T>;

export function segment(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value === "." ||
    value === ".." ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    throw new TypeError("Authyon: invalid route identifier.");
  }
  return encodeURIComponent(value);
}

export function permissionsBody(input: CredentialPermissionsInput): { permissions: string[] } {
  if (input.permissions !== undefined && input.scopes !== undefined) {
    throw new TypeError("Authyon: supply permissions or scopes, not both.");
  }
  const values = input.permissions ?? input.scopes;
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("Authyon: explicit credential permissions are required.");
  }
  const permissions = values.map((value: unknown) => {
    if (typeof value !== "string") throw new TypeError("Authyon: invalid permission.");
    const normalized = value.trim().toLowerCase();
    if (
      !/^(?:\*|[a-z][a-z0-9_-]*):(?:\*|[a-z][a-z0-9_-]*):(?:\*|[a-z][a-z0-9_-]*)$/u.test(normalized)
    ) {
      throw new TypeError("Authyon: permissions must have namespace:resource:action format.");
    }
    return normalized;
  });
  return { permissions: [...new Set(permissions)] };
}

export function lifetimeBody(input: { lifetimeDays?: number | null }): { lifetimeDays?: number } {
  if (input.lifetimeDays === undefined || input.lifetimeDays === null) return {};
  if (
    !Number.isInteger(input.lifetimeDays) ||
    input.lifetimeDays < 1 ||
    input.lifetimeDays > 3650
  ) {
    throw new RangeError("Authyon: lifetimeDays must be between 1 and 3650.");
  }
  return { lifetimeDays: input.lifetimeDays };
}

export function credentialQuery(options: CredentialListOptions = {}): CredentialListOptions {
  const { skip, take, search } = options;
  if (skip !== undefined && (!Number.isInteger(skip) || skip < 0 || skip > 2147483647))
    throw new RangeError("Authyon: invalid skip.");
  if (take !== undefined && (!Number.isInteger(take) || take < 1 || take > 100))
    throw new RangeError("Authyon: take must be between 1 and 100.");
  if (search !== undefined && (typeof search !== "string" || search.trim().length > 200))
    throw new RangeError("Authyon: search must contain at most 200 characters.");
  return { search: search?.trim() || undefined, skip, take };
}

/** Project API responses so unexpected secret/hash fields never escape read methods. */
export function credentialSummary(value: TenantCredentialSummary): TenantCredentialSummary {
  return {
    id: value.id,
    clientId: value.clientId,
    description: value.description,
    createdAt: value.createdAt,
    lastUsedAt: value.lastUsedAt,
    revokedAt: value.revokedAt,
    expiresAt: value.expiresAt ?? null,
    isActive: value.isActive,
    permissions: [...value.permissions],
  };
}
export function credentialDetail(value: CredentialDetail): CredentialDetail {
  return {
    ...credentialSummary(value),
    createdBy:
      value.createdBy == null
        ? null
        : {
            id: value.createdBy.id,
            type: value.createdBy.type,
            displayName: value.createdBy.displayName,
          },
    updatedAt: value.updatedAt,
    secretRotatedAt: value.secretRotatedAt,
    expiresAt: value.expiresAt ?? null,
    ageSeconds: value.ageSeconds,
    lifetimeSeconds: value.lifetimeSeconds,
    accessTokenLifetimeSeconds: value.accessTokenLifetimeSeconds,
  };
}
export async function credentialPage(
  request: ManagementRequest,
  path: string,
  options: CredentialListOptions = {},
): Promise<Paged<TenantCredentialSummary>> {
  const query = credentialQuery(options);
  const page = await request<Paged<TenantCredentialSummary>>(path, { query });
  if (!page || !Array.isArray(page.data))
    throw new TypeError("Authyon: expected a paginated credential response.");
  return {
    data: page.data.map(credentialSummary),
    ...(page.perPage === undefined ? {} : { perPage: page.perPage }),
    pageSize: page.pageSize,
    total: page.total,
    pages: page.pages,
    hasNext: page.hasNext,
    hasPrev: page.hasPrev,
  };
}

/** Compatibility with legacy array APIs; consume all pages on the current API. */
export async function allCredentials(
  request: ManagementRequest,
  path: string,
): Promise<TenantCredentialSummary[]> {
  const result: TenantCredentialSummary[] = [];
  const seen = new Set<string>();
  let skip = 0;
  for (let iteration = 0; iteration < 1000; iteration++) {
    const page = await request<Paged<TenantCredentialSummary> | TenantCredentialSummary[]>(
      path,
      iteration === 0 ? {} : { query: { skip, take: 100 } },
    );
    if (Array.isArray(page)) {
      if (iteration !== 0)
        throw new Error("Authyon: credential pagination changed during listing.");
      return page.map(credentialSummary);
    }
    if (!page || !Array.isArray(page.data))
      throw new TypeError("Authyon: invalid credential page.");
    for (const row of page.data) {
      if (seen.has(row.id))
        throw new Error("Authyon: credential pages overlapped; retry the listing.");
      seen.add(row.id);
      result.push(credentialSummary(row));
    }
    if (!page.hasNext) return result;
    if (page.data.length === 0) throw new Error("Authyon: credential pagination made no progress.");
    skip += page.data.length;
  }
  throw new Error("Authyon: use listPage for more than 1000 credential pages.");
}
