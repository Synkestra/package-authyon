import type {
  ConfirmFinancialAuthorizationInput,
  FinancialAuthorization,
  FinancialWebAuthnOptions,
} from "../contracts/financial";
import type { JsonRequestOptions } from "../http/jsonHttpClient";

/** Sends a request already authenticated as the customer (end-user bearer). */
export type SubjectRequest = <T>(path: string, options?: JsonRequestOptions) => Promise<T>;

function path(id: string, suffix = ""): string {
  if (typeof id !== "string" || !id.trim())
    throw new TypeError("Authyon: a financial authorization id is required.");
  return `/auth/authorizations/${encodeURIComponent(id)}${suffix}`;
}

/** Customer-side operations on a financial authorization (`/auth/authorizations`). */
export function subjectFinancialAuthorizations(request: SubjectRequest) {
  return {
    /** GET /auth/authorizations/{id} — the pending payload, to show before asking for the code. */
    get: (id: string): Promise<FinancialAuthorization> => request(path(id)),

    /** POST /auth/authorizations/{id}/webauthn/options — passkey options for approving this authorization. */
    webauthnOptions: (id: string): Promise<FinancialWebAuthnOptions> =>
      request(path(id, "/webauthn/options"), { method: "POST" }),

    /**
     * POST /auth/authorizations/{id}/confirm — approves the payload.
     *
     * Pass the authenticator code or passkey assertion to verify the second
     * factor inline (recommended). Without `input`, the session itself must
     * have used a passkey or authenticator code within the last 5 minutes,
     * otherwise the API answers `step_up_required`.
     */
    confirm: (
      id: string,
      input?: ConfirmFinancialAuthorizationInput,
    ): Promise<FinancialAuthorization> =>
      request(path(id, "/confirm"), { method: "POST", body: input }),

    /** POST /auth/authorizations/{id}/reject — the customer declines it. */
    reject: (id: string): Promise<FinancialAuthorization> =>
      request(path(id, "/reject"), { method: "POST" }),
  };
}

export type SubjectFinancialAuthorizations = ReturnType<typeof subjectFinancialAuthorizations>;
