import type {
  Approval,
  ApprovalWebAuthnOptions,
  ConfirmApprovalInput,
  SecurityMethods,
} from "../contracts/security";
import type { JsonRequestOptions } from "../http/jsonHttpClient";

/** Sends a request already authenticated as the customer (end-user bearer). */
export type SubjectRequest = <T>(path: string, options?: JsonRequestOptions) => Promise<T>;

/** Customer-side operations on an approval (`/auth/authorizations`). */
export interface SubjectApprovals {
  /** GET /auth/authorizations/{id} — the pending payload, to show before asking for the code. */
  get(id: string): Promise<Approval>;

  /** POST /auth/authorizations/{id}/webauthn/options — passkey options for approving it. */
  webauthnOptions(id: string): Promise<ApprovalWebAuthnOptions>;

  /**
   * POST /auth/authorizations/{id}/confirm — approves it.
   *
   * Pass the authenticator code or passkey assertion to verify the second
   * factor inline (recommended). Without `input`, the session itself must
   * have used a passkey or authenticator code within the last 5 minutes,
   * otherwise the API answers `step_up_required`.
   */
  confirm(id: string, input?: ConfirmApprovalInput): Promise<Approval>;

  /** POST /auth/authorizations/{id}/reject — the customer declines it. */
  reject(id: string): Promise<Approval>;
}

/** The `security` namespace an end-user client exposes. */
export interface SubjectSecurity {
  /**
   * GET /auth/me — which security methods the signed-in user has active
   * (password, authenticator, email code, passkeys, recovery codes, SSO).
   */
  methods(): Promise<SecurityMethods>;
  /** Approve or reject what your backend asked the customer to confirm. */
  readonly approvals: SubjectApprovals;
}

function path(id: string, suffix = ""): string {
  if (typeof id !== "string" || !id.trim())
    throw new TypeError("Authyon: an approval id is required.");
  return `/auth/authorizations/${encodeURIComponent(id)}${suffix}`;
}

const NO_METHODS: SecurityMethods = {
  password: false,
  authenticator: false,
  emailCode: false,
  passkey: false,
  passkeyCount: 0,
  recoveryCodes: 0,
  sso: [],
  twoFactor: false,
};

export function subjectSecurity(request: SubjectRequest): SubjectSecurity {
  return {
    methods: async () => {
      const me = await request<{ security?: SecurityMethods | null }>("/auth/me");
      return me.security ?? NO_METHODS;
    },
    approvals: {
      get: (id) => request(path(id)),
      webauthnOptions: (id) => request(path(id, "/webauthn/options"), { method: "POST" }),
      confirm: (id, input) => request(path(id, "/confirm"), { method: "POST", body: input }),
      reject: (id) => request(path(id, "/reject"), { method: "POST" }),
    },
  };
}
