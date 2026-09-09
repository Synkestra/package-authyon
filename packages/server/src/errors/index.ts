/**
 * Error thrown for any non-2xx Authyon API response.
 *
 * The API uses RFC 7807 problem+json: `{ title, status, detail, code }`.
 * Match on the machine-readable `code` (e.g. `user.email_taken`), never on `title`.
 */
export { AuthyonError, ErrorCodes } from "../../../../internal/core/errors/authyonError";
export type {
  AuthyonErrorAction,
  AuthyonErrorCategory,
  AuthyonErrorInterpretation,
  KnownErrorCode,
} from "../../../../internal/core/errors/authyonError";
