/**
 * Error thrown for any non-2xx Authyon API response.
 *
 * The API uses RFC 7807 problem+json: `{ title, status, detail, code }`.
 * Match on the machine-readable `code` (e.g. `user.email_taken`), never on `title`.
 */
export class AuthyonError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;

  constructor(status: number, body: Partial<{ title: string; detail: string; code: string }>) {
    super(body.detail ?? body.title ?? `Authyon request failed with status ${status}`);
    this.name = "AuthyonError";
    this.status = status;
    this.code = body.code ?? "unknown";
    this.title = body.title ?? "Error";
    this.detail = body.detail;
  }

  is(code: string): boolean {
    return this.code === code;
  }
}
