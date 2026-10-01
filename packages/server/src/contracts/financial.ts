import type {
  FinancialAssurance,
  FinancialTransaction,
} from "../../../../internal/core/contracts/financial";

export type {
  ConfirmFinancialAuthorizationInput,
  FinancialAssurance,
  FinancialAuthorization,
  FinancialAuthorizationStatus,
  FinancialTransaction,
  FinancialWebAuthnOptions,
} from "../../../../internal/core/contracts/financial";

/** POST /env/authorizations — a transaction awaiting the customer's approval. */
export interface CreateFinancialAuthorizationInput extends FinancialTransaction {
  /** Environment user who must approve. */
  subjectId: string;
  /** Restrict approval to a session in this tenant. */
  tenantId?: string;
  /** Lifetime in seconds, clamped to 60–600. Default 300. */
  expiresInSeconds?: number;
  /**
   * Sent as the `Idempotency-Key` header (max 128 chars). Retrying with the
   * same key and transaction returns the same authorization; the same key
   * with a different transaction fails with `idempotency_conflict`.
   */
  idempotencyKey: string;
}

/** POST /env/authorizations/{id}/consume — single-use redemption result. */
export interface ConsumedFinancialAuthorization {
  id: string;
  status: "consumed";
  consumedAt: string;
  transactionHash: string;
  assurance: FinancialAssurance | null;
}
