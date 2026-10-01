/** Lifecycle of a transaction-bound financial authorization. */
export type FinancialAuthorizationStatus =
  "pending" | "approved" | "denied" | "consumed" | "expired";

/**
 * The transaction the customer approves. The API hashes a canonical form of
 * these fields; `consume()` must resend exactly the same values (amount is
 * normalized to four decimal places, metadata keys are sorted).
 */
export interface FinancialTransaction {
  /** Business action, e.g. `"pix.transfer"`. Max 100 characters. */
  action: string;
  /** Positive amount, up to 15 integer digits and 4 decimal places. */
  amount: number;
  /** ISO 4217 currency code, e.g. `"BRL"`. */
  currency: string;
  /** Human-readable beneficiary shown to the customer. Max 256 characters. */
  beneficiary: string;
  /** Optional JSON object bound into the hash (max 16 KiB). */
  metadata?: Record<string, unknown>;
}

/** Evidence of how the customer proved their identity when approving. */
export interface FinancialAssurance {
  /** `urn:authyon:loa:3` (passkey) or `urn:authyon:loa:2` (authenticator code). */
  acr: string;
  /** Authentication methods, e.g. `["pwd", "otp"]` or `["pwd", "webauthn"]`. */
  amr: string[];
  /** When the second factor was verified (ISO 8601). */
  authTime: string;
}

export interface FinancialAuthorization {
  id: string;
  status: FinancialAuthorizationStatus;
  subjectId: string;
  tenantId?: string | null;
  action: string;
  amount: number;
  currency: string;
  beneficiary: string;
  /** SHA-256 (hex) of the canonical transaction. */
  transactionHash: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string | null;
  consumedAt?: string | null;
  /** Full canonical transaction — returned only to the customer (subject) view. */
  transaction?: FinancialTransaction | null;
  /** Present once approved. */
  assurance?: FinancialAssurance | null;
}

/** Inline second factor sent with `confirm()`. */
export type ConfirmFinancialAuthorizationInput =
  | {
      method: "authenticator";
      /** Six-digit code from the customer's authenticator app. */
      code: string;
    }
  | {
      method: "webauthn";
      /** Assertion for the options returned by `webauthnOptions()`. */
      webAuthn: {
        ceremonyToken: string;
        /** JSON-serialized `PublicKeyCredential` from `navigator.credentials.get()`. */
        assertionJson: string;
      };
    };

/** Passkey assertion options for approving one authorization. */
export interface FinancialWebAuthnOptions {
  ceremonyToken: string;
  /** JSON `PublicKeyCredentialRequestOptions` to pass to `navigator.credentials.get()`. */
  optionsJson: string;
}
