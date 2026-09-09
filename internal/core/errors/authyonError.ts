export const ErrorCodes = {
  Unknown: "unknown",
  NetworkError: "request.network_error",
  Timeout: "request.timeout",
  SessionMalformed: "session.malformed",
  NotAuthenticated: "auth.not_authenticated",
  InvalidToken: "auth.invalid_token",
  MissingToken: "auth.missing_token",
  EmailTaken: "user.email_taken",
  PasswordWeak: "user.password_weak",
  PasswordPwned: "user.password_pwned",
  RateLimited: "rate_limited",
} as const;

export type KnownErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
export type AuthyonErrorCategory =
  | "network"
  | "timeout"
  | "authentication"
  | "authorization"
  | "validation"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "server"
  | "unknown";
export type AuthyonErrorAction =
  | "retry"
  | "reauthenticate"
  | "request_access"
  | "fix_input"
  | "not_found"
  | "resolve_conflict"
  | "contact_support";

export interface AuthyonErrorInterpretation {
  category: AuthyonErrorCategory;
  action: AuthyonErrorAction;
  retryable: boolean;
  retryAfter?: number;
  requestId?: string;
}

/** Shared RFC 7807 error implementation used by both public SDKs. */
export class AuthyonError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly retryAfter?: number;
  readonly cause?: unknown;

  constructor(
    status: number,
    body: Partial<{ title: string; detail: string; code: string }>,
    options: { requestId?: string; retryAfter?: number; cause?: unknown } = {},
  ) {
    super(body.detail ?? body.title ?? `Authyon request failed with status ${status}`);
    this.name = "AuthyonError";
    this.status = status;
    this.code = body.code ?? "unknown";
    this.title = body.title ?? "Error";
    this.detail = body.detail;
    this.requestId = options.requestId;
    this.retryAfter = options.retryAfter;
    this.cause = options.cause;
  }

  is(code: string): boolean {
    return this.code === code;
  }

  isAny(...codes: readonly string[]): boolean {
    return codes.includes(this.code);
  }

  hasPrefix(prefix: string): boolean {
    return this.code.startsWith(prefix);
  }

  isStatus(...statuses: readonly number[]): boolean {
    return statuses.includes(this.status);
  }

  /** Stable interpretation for UI decisions, retries, telemetry and support flows. */
  interpret(): AuthyonErrorInterpretation {
    const category = classifyError(this.status, this.code);
    return {
      category,
      action: actionFor(category),
      retryable: isRetryable(category),
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      ...(this.requestId !== undefined ? { requestId: this.requestId } : {}),
    };
  }

  get category(): AuthyonErrorCategory {
    return this.interpret().category;
  }

  get retryable(): boolean {
    return this.interpret().retryable;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      title: this.title,
      detail: this.detail,
      requestId: this.requestId,
      retryAfter: this.retryAfter,
      ...this.interpret(),
    };
  }
}

function classifyError(status: number, code: string): AuthyonErrorCategory {
  if (code === ErrorCodes.NetworkError) return "network";
  if (code === ErrorCodes.Timeout || status === 408) return "timeout";
  if (code === ErrorCodes.RateLimited || status === 429) return "rate_limit";
  if (code === ErrorCodes.EmailTaken || status === 409) return "conflict";
  if (code === ErrorCodes.PasswordWeak || code === ErrorCodes.PasswordPwned) return "validation";
  if (code === ErrorCodes.SessionMalformed) return "server";
  if (code.startsWith("auth.") || status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "validation";
  if (status >= 500) return "server";
  return "unknown";
}

function actionFor(category: AuthyonErrorCategory): AuthyonErrorAction {
  switch (category) {
    case "network":
    case "timeout":
    case "rate_limit":
    case "server":
      return "retry";
    case "authentication":
      return "reauthenticate";
    case "authorization":
      return "request_access";
    case "validation":
      return "fix_input";
    case "not_found":
      return "not_found";
    case "conflict":
      return "resolve_conflict";
    case "unknown":
      return "contact_support";
  }
}

function isRetryable(category: AuthyonErrorCategory): boolean {
  return (
    category === "network" ||
    category === "timeout" ||
    category === "rate_limit" ||
    category === "server"
  );
}
