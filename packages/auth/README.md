# @authyon/auth

SDK JS/TS para o [Authyon](https://authyon.com) — autenticação, sessões, multi-tenant e 2FA, com armazenamento e refresh de tokens transparentes.

Cobre todos os endpoints públicos documentados em [authyon.com/docs](https://authyon.com/docs), usando a **publishable key** (`pk_...`) — segura para expor no navegador.

Para gestão de organização/membros (secret key) e verificação de token no backend, veja [`@authyon/server`](../server).

## Instalação

```bash
npm install @authyon/auth
```

## Uso rápido

```ts
import { createClient } from "@authyon/auth";

const authyon = createClient({ envKey: "pk_live_..." });

// Login (com suporte a 2FA)
const result = await authyon.login({
  email: "alice@acme.com",
  password: "...",
  organizationSlug: "acme", // opcional
});

if (result.twoFactorRequired) {
  const code = prompt(`Código 2FA (${result.methods.join(", ")})`);
  await authyon.verifyTwoFactor({
    challengeToken: result.challengeToken,
    method: "authenticator",
    code: code!,
  });
}

// Usuário atual — o access token é renovado automaticamente quando necessário
const user = await authyon.user.me();
```

## Sessão e tokens

- Tokens persistem em `localStorage` por padrão (`memoryStorage()` ou um `TokenStorage` próprio via opção `storage`).
- `getAccessToken()` renova o token automaticamente antes de expirar (refresh token é single-use e rotacionado, com single-flight para evitar corridas).
- Chamadas autenticadas que retornam 401 fazem um refresh e uma retentativa automática.

```ts
const token = await authyon.getAccessToken(); // sempre válido, ou null se deslogado

const unsubscribe = authyon.onAuthStateChange((event) => {
  // "signed_in" | "refreshed" | "signed_out"
  console.log(event.type);
});
```

## API

Métodos de sessão/auth ficam soltos no client; os que giram em torno de um recurso específico ficam agrupados em namespaces (`user`, `organization`, `twoFactor`, `webauthn`, `sso`).

| Método                                                                   | Endpoint                |
| ------------------------------------------------------------------------ | ----------------------- |
| `register({ email, username, password })`                                | `POST /auth/register`   |
| `login({ email \| username, password, organizationSlug? })`              | `POST /auth/login`      |
| `verifyTwoFactor({ challengeToken, method, code?, webAuthnAssertion? })` | `POST /auth/2fa/verify` |
| `refresh()`                                                              | `POST /auth/refresh`    |
| `logout({ everywhere? })`                                                | `POST /auth/logout`     |
| `introspect(token?)`                                                     | `POST /auth/introspect` |
| `validate(token?)`                                                       | `POST /auth/validate`   |

### `authyon.user`

| Método                                          | Endpoint                            |
| ----------------------------------------------- | ----------------------------------- |
| `user.me()`                                     | `GET /auth/me`                      |
| `user.sessions()`                               | `GET /auth/sessions`                |
| `user.revokeSession(sessionId)`                 | `DELETE /auth/sessions/{id}`        |
| `user.activities(params?)`                      | `GET /auth/me/activities`           |
| `user.requestPasswordReset(email)`              | `POST /auth/password-reset/request` |
| `user.confirmPasswordReset(token, newPassword)` | `POST /auth/password-reset/confirm` |

### `authyon.organization`

| Método                                                | Endpoint                                       |
| ----------------------------------------------------- | ---------------------------------------------- |
| `organization.list()`                                 | `GET /auth/tenants`                            |
| `organization.create(params?)`                        | `POST /auth/tenants`                           |
| `organization.get(organizationId)`                    | `GET /auth/tenants/{id}`                       |
| `organization.rename(organizationId, name)`           | `PATCH /auth/tenants/{id}`                     |
| `organization.switch(slug)`                           | `POST /auth/switch-tenant`                     |
| `organization.current()`                              | — (lê `activeOrganization` da sessão em cache) |
| `organization.members.list(organizationId, params?)`  | `GET /auth/tenants/{id}/members`               |
| `organization.members.invite(organizationId, params)` | `POST /auth/tenants/{id}/members`              |
| `organization.members.remove(organizationId, userId)` | `DELETE /auth/tenants/{id}/members/{userId}`   |
| `organization.roles.list(organizationId)`             | `GET /auth/tenants/{id}/roles`                 |

### `authyon.twoFactor`

| Método                                               | Endpoint                                     |
| ---------------------------------------------------- | -------------------------------------------- |
| `twoFactor.status()`                                 | `GET /auth/2fa/status`                       |
| `twoFactor.resendEmail(challengeToken)`              | `POST /auth/2fa/resend-email`                |
| `twoFactor.setupAuthenticator()`                     | `POST /auth/2fa/authenticator/setup`         |
| `twoFactor.confirmAuthenticator(code)`               | `POST /auth/2fa/authenticator/confirm`       |
| `twoFactor.enableEmail(code?)`                       | `POST /auth/2fa/email/enable`                |
| `twoFactor.disable(method, currentPassword)`         | `POST /auth/2fa/disable`                     |
| `twoFactor.regenerateRecoveryCodes(currentPassword)` | `POST /auth/2fa/recovery-codes/regenerate`   |
| `twoFactor.webauthn.registerStart()`                 | `POST /auth/2fa/webauthn/register/start`     |
| `twoFactor.webauthn.registerFinish(...)`             | `POST /auth/2fa/webauthn/register/finish`    |
| `twoFactor.webauthn.credentials()`                   | `GET /auth/2fa/webauthn/credentials`         |
| `twoFactor.webauthn.renameCredential(id, nickname)`  | `PATCH /auth/2fa/webauthn/credentials/{id}`  |
| `twoFactor.webauthn.removeCredential(id, pwd)`       | `DELETE /auth/2fa/webauthn/credentials/{id}` |
| `twoFactor.webauthn.assertionStart(challengeToken)`  | `POST /auth/2fa/webauthn/assertion/start`    |

### `authyon.webauthn` (login sem senha)

| Método                            | Endpoint                           |
| --------------------------------- | ---------------------------------- |
| `webauthn.loginStart(email?)`     | `POST /auth/webauthn/login/start`  |
| `webauthn.loginFinish(assertion)` | `POST /auth/webauthn/login/finish` |

### `authyon.sso` (login social)

| Método                           | Endpoint                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `sso.providers()`                | `GET /auth/sso/providers`                                                             |
| `sso.startUrl(provider, params)` | monta a URL de `GET /auth/sso/{provider}/start` (não faz a chamada — navegue até ela) |
| `sso.exchange(code)`             | `POST /auth/sso/exchange`                                                             |

## Invalidação de token

- **Sessão atual**: `logout()` revoga o refresh token atual; `logout({ everywhere: true })` revoga todos os refresh tokens do usuário.
- **Uma sessão específica**: `user.revokeSession(sessionId)`, usando o `id` retornado por `user.sessions()` — derruba um dispositivo sem afetar a sessão atual.
- **Access token**: por ser um JWT stateless, o access token continua "válido" até expirar (`expiresIn`, tipicamente 30 min) mesmo após revogar o refresh token. Para checar revogação em tempo real no seu backend, use `validate()` (cross-checa o estado no banco) em vez de `introspect()`.

## Erros

Toda resposta não-2xx vira um `AuthyonError` (problem+json). Compare pelo `code` legível por máquina, nunca pelo `title`:

```ts
import { AuthyonError, ErrorCodes } from "@authyon/auth";

try {
  await authyon.register({ email, password });
} catch (err) {
  if (err instanceof AuthyonError && err.is(ErrorCodes.EmailTaken)) {
    // e-mail já cadastrado
  }
}
```

## Build

```bash
npm install
npm run build      # dist/ (ESM + CJS + .d.ts via tsup)
npm run typecheck
```
