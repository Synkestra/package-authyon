# Catálogo de erros

Este catálogo reúne todos os códigos encontrados no SDK, exemplos e documentação local. A API usa RFC 7807 (`title`, `status`, `detail`, `code`) e pode acrescentar códigos sem exigir uma nova versão do SDK; por isso `AuthyonError.interpret()` combina código, prefixo e status HTTP.

| Constante          | Código                   | Categoria        | Ação sugerida                            |
| ------------------ | ------------------------ | ---------------- | ---------------------------------------- |
| `Unknown`          | `unknown`                | `unknown`        | registrar `requestId` e contatar suporte |
| `NetworkError`     | `request.network_error`  | `network`        | tentar novamente                         |
| `Timeout`          | `request.timeout`        | `timeout`        | tentar novamente                         |
| `SessionMalformed` | `session.malformed`      | `server`         | tentar novamente; reportar se persistir  |
| `NotAuthenticated` | `auth.not_authenticated` | `authentication` | autenticar novamente                     |
| `InvalidToken`     | `auth.invalid_token`     | `authentication` | autenticar novamente                     |
| `MissingToken`     | `auth.missing_token`     | `authentication` | enviar bearer token                      |
| `EmailTaken`       | `user.email_taken`       | `conflict`       | usar outro e-mail ou fazer login         |
| `PasswordWeak`     | `user.password_weak`     | `validation`     | corrigir a senha                         |
| `PasswordPwned`    | `user.password_pwned`    | `validation`     | escolher senha não vazada                |
| `RateLimited`      | `rate_limited`           | `rate_limit`     | aguardar `retryAfter` e repetir          |

## OTP e step-up

A API envia estes erros no formato OAuth (`error`/`error_description`); o SDK os expõe
como `code`/`detail`. Campos extras ficam em `AuthyonError.extensions`. Veja o
[guia de segurança](./docs/security-otp-approvals.md).

| Constante                       | Código                            | Categoria        | Ação sugerida                                     |
| ------------------------------- | --------------------------------- | ---------------- | ------------------------------------------------- |
| `StepUpRequired`                | `step_up_required`                | `authentication` | pedir o código do autenticador ou a passkey       |
| `InvalidSecondFactorCode`       | `invalid_code`                    | `validation`     | pedir de novo; ver `extensions.attemptsRemaining` |
| `VerificationAttemptsExhausted` | `verification_attempts_exhausted` | `conflict`       | criar nova autorização                            |
| `MethodNotEnrolled`             | `method_not_enrolled`             | `validation`     | cadastrar autenticador ou passkey                 |
| `InvalidApprovalState`          | `invalid_authorization_state`     | `conflict`       | ler `extensions.status`                           |
| `PayloadMismatch`               | `payload_mismatch`                | `validation`     | não executar a operação                           |
| `ApprovalNotConsumable`         | `authorization_not_consumable`    | `conflict`       | não executar a operação                           |
| `IdempotencyConflict`           | `idempotency_conflict`            | `conflict`       | usar outra `Idempotency-Key`                      |
| `UserNotFound`                  | `user_not_found`                  | `not_found`      | conferir o id do usuário                          |
| `UserDisabled`                  | `user_disabled`                   | `authorization`  | usuário desativado, suspenso ou excluído          |
| `TemporarilyUnavailable`        | `temporarily_unavailable`         | `server`         | tentar de novo em instantes                       |
| `InsufficientScope`             | `insufficient_scope`              | `authorization`  | dar o escopo em `extensions.requiredScope`        |
| `CredentialThrottled`           | `credential_throttled`            | `rate_limit`     | credencial pausada; investigar e aguardar         |
| `ApprovalNotFound`              | `authorization_not_found`         | `not_found`      | id inexistente ou de outro usuário/credencial     |
| `SessionRevoked`                | `session_revoked`                 | `authentication` | 3 códigos errados seguidos; fazer login de novo   |
| `TwoFactorTooManyFailures`      | `user.2fa.too_many_failures`      | `authorization`  | 3 códigos errados seguidos; fazer login de novo   |

## Fallback por status HTTP

| Status       | Categoria        | Ação                                          |
| ------------ | ---------------- | --------------------------------------------- |
| `400`, `422` | `validation`     | corrigir entrada                              |
| `401`        | `authentication` | autenticar novamente                          |
| `403`        | `authorization`  | solicitar acesso                              |
| `404`        | `not_found`      | tratar recurso ausente                        |
| `408`        | `timeout`        | tentar novamente                              |
| `409`        | `conflict`       | resolver conflito                             |
| `429`        | `rate_limit`     | respeitar `retryAfter`                        |
| `5xx`        | `server`         | tentar novamente; usar `requestId` no suporte |

## Uso

```ts
try {
  await authyon.login({ email, password });
} catch (cause) {
  if (!(cause instanceof AuthyonError)) throw cause;

  const error = cause.interpret();
  if (error.action === "reauthenticate") redirectToLogin();
  if (error.retryable) scheduleRetry(error.retryAfter);
  telemetry.capture(cause.toJSON());
}
```

Mensagens de `title` e `detail` podem mudar ou vir em outro idioma. Decisões de código devem usar `code`, `category` ou `action`.
