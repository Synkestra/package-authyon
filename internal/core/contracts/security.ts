/**
 * Security methods active on the user's account, as returned in the
 * `security` field of `GET /auth/me` and `POST /auth/validate`.
 */
export interface SecurityMethods {
  /** A password is set (false for accounts created only through SSO or magic link). */
  password: boolean;
  /** Authenticator app (TOTP one-time codes). */
  authenticator: boolean;
  /** One-time codes sent by email. */
  emailCode: boolean;
  /** At least one passkey registered. */
  passkey: boolean;
  passkeyCount: number;
  /** Unused recovery codes left. */
  recoveryCodes: number;
  /** SSO providers linked to the account, e.g. `["google", "github"]`. */
  sso: string[];
  /** Any second factor is active (authenticator, email code or passkey). */
  twoFactor: boolean;
}

/** Lifecycle of an approval. */
export type ApprovalStatus = "pending" | "approved" | "denied" | "consumed" | "expired";

/**
 * Free-form JSON object describing what the customer approves (up to 16 KiB).
 * The API stores it, shows it back to the customer and binds its canonical
 * hash (keys sorted) to the approval.
 */
export type ApprovalPayload = Record<string, unknown>;

/** Evidence of how the customer proved their identity when approving. */
export interface ApprovalAssurance {
  /** `urn:authyon:loa:3` (passkey) or `urn:authyon:loa:2` (authenticator code). */
  acr: string;
  /** Authentication methods, e.g. `["pwd", "otp"]` or `["pwd", "webauthn"]`. */
  amr: string[];
  /** When the second factor was verified (ISO 8601). */
  authTime: string;
}

/** A request for the customer to approve something with a second factor. */
export interface Approval {
  id: string;
  status: ApprovalStatus;
  subjectId: string;
  tenantId?: string | null;
  /** The payload given to `create()`, with keys in canonical order. */
  payload: ApprovalPayload;
  /** SHA-256 (hex) of the canonical payload. */
  payloadHash: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string | null;
  consumedAt?: string | null;
  /** Present once approved. */
  assurance?: ApprovalAssurance | null;
}

/** Second factor sent with `confirm()`. */
export type ConfirmApprovalInput =
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

/** Passkey assertion options for approving one approval. */
export interface ApprovalWebAuthnOptions {
  ceremonyToken: string;
  /** JSON `PublicKeyCredentialRequestOptions` to pass to `navigator.credentials.get()`. */
  optionsJson: string;
}
