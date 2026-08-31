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
