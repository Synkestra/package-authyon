import { AuthyonError } from "../errors";
import {
  BffSessionError,
  type BffSessionOptions,
  type BffSessionRecord,
  type BffTokens,
  type BffUser,
} from "./contracts";
import { BffSessionRepository, newSessionSecret, type BffSessionLease } from "./sessionRepository";

const DEFAULT_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_REFRESH_AHEAD_MS = 30_000;

function positiveDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Authyon BFF: durations must be positive integer milliseconds");
  return value;
}

function rejectedCredential(error: unknown): boolean {
  return error instanceof AuthyonError && [401, 403].includes(error.status);
}

export class BffSessionManager {
  private readonly repository: BffSessionRepository;
  private readonly absoluteTimeout: number;
  private readonly idleTimeout: number;
  private readonly refreshAhead: number;

  constructor(private readonly options: BffSessionOptions) {
    this.repository = new BffSessionRepository(options.store, options.origin);
    this.absoluteTimeout = positiveDuration(
      options.absoluteTimeoutMs ?? DEFAULT_ABSOLUTE_TIMEOUT_MS,
    );
    this.idleTimeout = positiveDuration(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
    this.refreshAhead = positiveDuration(options.refreshAheadMs ?? DEFAULT_REFRESH_AHEAD_MS);
    if (this.idleTimeout > this.absoluteTimeout)
      throw new Error("Authyon BFF: idle timeout must not exceed absolute timeout");
  }

  async create(
    tokens: BffTokens,
    organizationSlug?: string,
  ): Promise<{ id: string; record: BffSessionRecord }> {
    try {
      const user = await this.verifiedProfile(tokens);
      if (organizationSlug !== undefined && user.organization?.slug !== organizationSlug) {
        throw new BffSessionError("session.organization_mismatch", 502);
      }
      const record: BffSessionRecord = {
        tokens,
        user,
        revision: newSessionSecret(),
        busyUntil: null,
        expiresAt: Date.now() + this.absoluteTimeout,
        idleExpiresAt: Date.now() + this.idleTimeout,
      };
      return { id: await this.repository.create(record), record };
    } catch (error) {
      await this.revokeUnstoredTokens(tokens);
      throw error;
    }
  }

  async read(id: string): Promise<BffSessionRecord> {
    return this.update(id, async (lease) => {
      const refreshed = await this.refreshIfNeeded(lease);
      if (!refreshed && !(await this.options.provider.validate(lease.record.tokens.accessToken))) {
        throw new BffSessionError("session.revoked", 401, true);
      }
    });
  }

  async switchOrganization(id: string, slug: string): Promise<BffSessionRecord> {
    return this.update(id, async (lease) => {
      const refreshed = await this.refreshIfNeeded(lease);
      if (!refreshed && !(await this.options.provider.validate(lease.record.tokens.accessToken))) {
        throw new BffSessionError("session.revoked", 401, true);
      }
      await this.rotate(lease, {
        issue: () => this.issueOrganizationTokens(lease.record.tokens.accessToken, slug),
        accepts: (user) => user.id === lease.record.user.id && user.organization?.slug === slug,
      });
    });
  }

  async logout(id: string): Promise<void> {
    const lease = await this.repository.acquire(id);
    // Local revocation happens before network I/O, even when the provider is down.
    await this.repository.remove(lease);
    try {
      await this.options.provider.logout(lease.record.tokens.refreshToken);
    } catch {
      throw new BffSessionError("session.upstream_revocation_failed", 503, true);
    }
  }

  private async update(
    id: string,
    operation: (lease: BffSessionLease) => Promise<void>,
  ): Promise<BffSessionRecord> {
    const lease = await this.repository.acquire(id);
    try {
      await operation(lease);
    } catch (error) {
      if (rejectedCredential(error) || (error instanceof BffSessionError && error.clearCookie)) {
        await this.repository.remove(lease);
        if (error instanceof BffSessionError) throw error;
        throw new BffSessionError("session.revoked", 401, true);
      }
      await this.repository.release(lease);
      throw error;
    }
    lease.record.idleExpiresAt = Math.min(lease.record.expiresAt, Date.now() + this.idleTimeout);
    await this.repository.release(lease);
    return lease.record;
  }

  private async refreshIfNeeded(lease: BffSessionLease): Promise<boolean> {
    if (lease.record.tokens.expiresAt - this.refreshAhead > Date.now()) return false;
    await this.rotate(lease, {
      issue: () => this.options.provider.refresh(lease.record.tokens.refreshToken),
      accepts: (user) =>
        user.id === lease.record.user.id &&
        user.organization?.id === lease.record.user.organization?.id,
    });
    return true;
  }

  private async rotate(
    lease: BffSessionLease,
    operation: { issue: () => Promise<BffTokens>; accepts: (user: BffUser) => boolean },
  ): Promise<void> {
    let tokens: BffTokens;
    try {
      tokens = await operation.issue();
    } catch (error) {
      // A definitive rate-limit response does not consume a refresh grant.
      if (error instanceof AuthyonError && error.status === 429) throw error;
      if (error instanceof BffSessionError && error.code === "organization.forbidden") throw error;
      if (rejectedCredential(error)) throw error;
      if (error instanceof BffSessionError && error.clearCookie) throw error;
      throw new BffSessionError("session.rotation_interrupted", 503, true);
    }
    try {
      const user = await this.verifiedProfile(tokens);
      if (!operation.accepts(user))
        throw new BffSessionError("session.identity_changed", 502, true);
      lease.record.tokens = tokens;
      lease.record.user = user;
    } catch {
      await this.revokeUnstoredTokens(tokens);
      // Once issuance succeeded, even a subsequent 429 cannot restore the old pair.
      throw new BffSessionError("session.rotation_interrupted", 503, true);
    }
  }

  private async issueOrganizationTokens(accessToken: string, slug: string): Promise<BffTokens> {
    try {
      return await this.options.provider.switchOrganization(accessToken, slug);
    } catch (error) {
      if (error instanceof AuthyonError && error.status === 403)
        throw new BffSessionError("organization.forbidden", 403);
      throw error;
    }
  }

  private async verifiedProfile(tokens: BffTokens): Promise<BffUser> {
    if (
      !tokens.accessToken ||
      !tokens.refreshToken ||
      !Number.isFinite(tokens.expiresAt) ||
      tokens.expiresAt <= Date.now()
    ) {
      throw new BffSessionError("provider.invalid_tokens", 502);
    }
    if (!(await this.options.provider.validate(tokens.accessToken)))
      throw new BffSessionError("session.revoked", 401, true);
    const user = await this.options.provider.profile(tokens.accessToken);
    // Keep the allowlist even for custom provider adapters.
    return {
      id: user.id,
      email: user.email,
      organization: user.organization
        ? { id: user.organization.id, slug: user.organization.slug }
        : null,
    };
  }

  private async revokeUnstoredTokens(tokens: BffTokens): Promise<void> {
    try {
      await this.options.provider.logout(tokens.refreshToken);
    } catch {
      throw new BffSessionError("session.upstream_revocation_failed", 503, true);
    }
  }
}
