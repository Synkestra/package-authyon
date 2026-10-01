import type {
  ApprovalAssurance,
  ApprovalPayload,
} from "../../../../internal/core/contracts/security";

export type {
  Approval,
  ApprovalAssurance,
  ApprovalPayload,
  ApprovalStatus,
  ApprovalWebAuthnOptions,
  ConfirmApprovalInput,
} from "../../../../internal/core/contracts/security";

/** `security.approvals.create()` — something awaiting the customer's approval. */
export interface CreateApprovalInput {
  /** Environment user who must approve. */
  subjectId: string;
  /** Any JSON object (up to 16 KiB) describing what is being approved. Default `{}`. */
  payload?: ApprovalPayload;
  /** Restrict approval to a session in this tenant. */
  tenantId?: string;
  /** Lifetime in seconds, clamped to 60–600. Default 300. */
  expiresInSeconds?: number;
  /**
   * Optional. Sent as the `Idempotency-Key` header (max 128 chars): retrying
   * with the same key and payload returns the same approval; the same key
   * with a different payload fails with `idempotency_conflict`.
   */
  idempotencyKey?: string;
}

/** `security.approvals.consume()` — single-use redemption result. */
export interface ConsumedApproval {
  id: string;
  status: "consumed";
  consumedAt: string;
  /** The approved payload — execute exactly this. */
  payload: ApprovalPayload;
  payloadHash: string;
  assurance: ApprovalAssurance | null;
}

/** `security.otp.check()` result. */
export type OtpCheckResult =
  | {
      valid: true;
      userId: string;
      /** Always `"otp"` (authenticator app). */
      method: string;
      verifiedAt: string;
    }
  | {
      valid: false;
      /**
       * Wrong codes left before the first consequence: the sign-out (3 in a
       * row) or the 15-minute lock (5). `0` when the user was just signed out.
       */
      attemptsRemaining: number;
      /**
       * True when this was the 3rd wrong code in a row (counted across login
       * 2FA, `security.otp.check` and `security.approvals.confirm`): every
       * session of the user was ended and they must sign in again.
       */
      sessionsRevoked?: boolean;
    };
