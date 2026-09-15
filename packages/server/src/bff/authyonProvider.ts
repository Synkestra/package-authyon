import { DEFAULT_BASE_URL } from "../../../../internal/core/config/defaults";
import { JsonHttpClient } from "../../../../internal/core/http/jsonHttpClient";
import {
  createSharedTransport,
  type SharedTransportOptions,
} from "../../../../internal/core/http/transport";
import type { AuthyonServerClient } from "../client/authyonServerClient";
import { AuthyonError } from "../errors";
import {
  BffSessionError,
  type BffAuthProvider,
  type BffChallenge,
  type BffTokens,
  type BffUser,
} from "./contracts";

export interface AuthyonBffProviderOptions extends Omit<SharedTransportOptions, "baseUrl"> {
  baseUrl?: string;
  envKey: string;
  /** Reuses the server client's database-backed validation, not offline JWT verification. */
  validator: Pick<AuthyonServerClient, "validate">;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BffSessionError("provider.malformed_response", 502);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BffSessionError("provider.malformed_response", 502);
  }
  return value;
}

function readTokens(value: unknown): BffTokens {
  const response = object(value);
  const tokens = object(response.tokens ?? response);
  if (
    typeof tokens.expiresIn !== "number" ||
    !Number.isFinite(tokens.expiresIn) ||
    tokens.expiresIn <= 0
  ) {
    // An opaque server session cannot safely invent an upstream token lifetime.
    throw new BffSessionError("provider.missing_token_lifetime", 502);
  }
  return {
    accessToken: requiredString(tokens.accessToken),
    refreshToken: requiredString(tokens.refreshToken),
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  };
}

function readChallenge(value: unknown): BffChallenge {
  const challenge = object(value);
  if (
    !Array.isArray(challenge.methods) ||
    !challenge.methods.every((method) => typeof method === "string")
  ) {
    throw new BffSessionError("provider.malformed_challenge", 502);
  }
  return {
    twoFactorRequired: true,
    challengeToken: requiredString(challenge.challengeToken),
    methods: challenge.methods,
  };
}

function readProfile(value: unknown): BffUser {
  const user = object(value);
  const activeOrganization = user.activeOrganization ?? user.tenant;
  const organization = activeOrganization == null ? null : object(activeOrganization);
  return {
    id: requiredString(user.id),
    email: requiredString(user.email),
    organization: organization
      ? { id: requiredString(organization.id), slug: requiredString(organization.slug) }
      : null,
  };
}

export function createAuthyonBffProvider(options: AuthyonBffProviderOptions): BffAuthProvider {
  if (!options.envKey) throw new Error("Authyon BFF: envKey is required");
  const http = new JsonHttpClient(
    createSharedTransport({
      ...options,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    }),
  );
  const headers = { "X-Authyon-Environment": options.envKey };
  const bearer = (token: string) => ({ ...headers, Authorization: `Bearer ${token}` });

  return {
    async login(input) {
      const credentials = { ...input };
      delete credentials.organizationSlug;
      delete credentials.sessionPersistence;
      const response = object(
        await http.request("/auth/login", {
          method: "POST",
          headers,
          body: {
            ...credentials,
            ...(input.organizationSlug ? { tenantSlug: input.organizationSlug } : {}),
          },
        }),
      );
      return response.twoFactor ? readChallenge(response.twoFactor) : readTokens(response);
    },
    async verifyTwoFactor(input) {
      const verification = { ...input };
      delete verification.sessionPersistence;
      return readTokens(
        await http.request("/auth/2fa/verify", { method: "POST", headers, body: verification }),
      );
    },
    async refresh(refreshToken) {
      return readTokens(
        await http.request("/auth/refresh", { method: "POST", headers, body: { refreshToken } }),
      );
    },
    async logout(refreshToken) {
      await http.request("/auth/logout", { method: "POST", headers, body: { refreshToken } });
    },
    async switchOrganization(accessToken, slug) {
      return readTokens(
        await http.request("/auth/switch-tenant", {
          method: "POST",
          headers: bearer(accessToken),
          body: { tenantSlug: slug },
        }),
      );
    },
    async validate(accessToken) {
      try {
        const result = await options.validator.validate(accessToken);
        return result.valid === true && result.user != null;
      } catch (error) {
        // HTTP 401 here can reject the caller's machine credentials, not the user.
        if (error instanceof AuthyonError)
          throw new BffSessionError("provider.validation_unavailable", 503);
        throw error;
      }
    },
    async profile(accessToken) {
      return readProfile(await http.request("/auth/me", { headers: bearer(accessToken) }));
    },
  };
}
