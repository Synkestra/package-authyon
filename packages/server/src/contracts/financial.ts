import type {
  FinancialAssurance,
  FinancialAuthorizationPayload,
} from "../../../../internal/core/contracts/financial";

export type {
  ConfirmFinancialAuthorizationInput,
  FinancialAssurance,
  FinancialAuthorization,
  FinancialAuthorizationPayload,
  FinancialAuthorizationStatus,
  FinancialWebAuthnOptions,
} from "../../../../internal/core/contracts/financial";

/** POST /env/authorizations — something awaiting the customer's approval. */
export interface CreateFinancialAuthorizationInput {
  /** Environment user who must approve. */
  subjectId: string;
  /** Any JSON object (up to 16 KiB) describing what is being approved. Default `{}`. */
  payload?: FinancialAuthorizationPayload;
  /** Restrict approval to a session in this tenant. */
  tenantId?: string;
  /** Lifetime in seconds, clamped to 60–600. Default 300. */
  expiresInSeconds?: number;
  /**
   * Optional. Sent as the `Idempotency-Key` header (max 128 chars): retrying
   * with the same key and payload returns the same authorization; the same
   * key with a different payload fails with `idempotency_conflict`.
   */
  idempotencyKey?: string;
}

/** POST /env/authorizations/{id}/consume — single-use redemption result. */
export interface ConsumedFinancialAuthorization {
  id: string;
  status: "consumed";
  consumedAt: string;
  /** The approved payload — execute exactly this. */
  payload: FinancialAuthorizationPayload;
  payloadHash: string;
  assurance: FinancialAssurance | null;
}

/** POST /env/users/{userId}/otp/verify. */
export type OtpVerificationResult =
  | {
      valid: true;
      userId: string;
      /** Always `"otp"` (authenticator app). */
      method: string;
      verifiedAt: string;
    }
  | {
      valid: false;
      /** Failures left before the check locks for 15 minutes. */
      attemptsRemaining: number;
      /**
       * True when this was the 3rd wrong code in a row (counted across login
       * 2FA, `verifyOtp` and `confirm`): every session of the user was ended
       * and they must sign in again.
       */
      sessionsRevoked?: boolean;
    };
