/** Lifecycle of a payload-bound authorization. */
export type FinancialAuthorizationStatus =
  "pending" | "approved" | "denied" | "consumed" | "expired";

/**
 * Free-form JSON object describing what the customer approves (up to 16 KiB).
 * The API stores it, shows it back to the customer and binds its canonical
 * hash (keys sorted) to the approval.
 */
export type FinancialAuthorizationPayload = Record<string, unknown>;

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
  /** The payload given to `create()`, with keys in canonical order. */
  payload: FinancialAuthorizationPayload;
  /** SHA-256 (hex) of the canonical payload. */
  payloadHash: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string | null;
  consumedAt?: string | null;
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
