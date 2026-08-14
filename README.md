# @authyon/browser

SDK JS/TS para o [Authyon](https://authyon.com) — autenticação, sessões, multi-tenant e 2FA, com armazenamento e refresh de tokens transparentes.

Cobre todos os endpoints públicos documentados em [authyon.com/docs](https://authyon.com/docs).

## Instalação

```bash
npm install @authyon/browser
```

## Uso rápido

```ts
import { createClient } from "@authyon/browser";

const authyon = createClient({ envKey: "pk_live_..." });

// Login (com suporte a 2FA)
const result = await authyon.login({
  email: "alice@acme.com",
  password: "...",
  organizationSlug: "acme", // opcional
});

if (result.twoFactorRequired) {
  const code = prompt(`Código 2FA (${result.methods.join(", ")})`);
  await authyon.completeTwoFactorChallenge({
    challengeId: result.challengeId,
    method: "authenticator",
    code: code!,
  });
}

// Usuário atual — o access token é renovado automaticamente quando necessário
const user = await authyon.me();
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

| Método | Endpoint |
| --- | --- |
| `register({ email, username, password })` | `POST /auth/register` |
| `login({ email \| username, password, organizationSlug? })` | `POST /auth/login` |
| `completeTwoFactorChallenge({ challengeId, code \| recoveryCode, method? })` | `POST /auth/2fa/challenge` |
| `refresh()` | `POST /auth/refresh` |
| `logout({ everywhere? })` | `POST /auth/logout` |
| `me()` | `GET /auth/me` |
| `organizations()` | `GET /auth/tenants` |
| `switchOrganization(slug)` | `POST /auth/switch-tenant` |
| `sessions()` | `GET /auth/sessions` |
| `requestPasswordReset(email)` | `POST /auth/password-reset/request` |
| `confirmPasswordReset(token, newPassword)` | `POST /auth/password-reset/confirm` |
| `twoFactor.status()` | `GET /auth/2fa/status` |
| `twoFactor.setupAuthenticator()` | `POST /auth/2fa/authenticator/setup` |
| `twoFactor.confirmAuthenticator(code)` | `POST /auth/2fa/authenticator/confirm` |
| `twoFactor.regenerateRecoveryCodes()` | `POST /auth/2fa/recovery-codes/regenerate` |
| `introspect(token?)` | `POST /auth/introspect` |
| `validate(token?)` | `POST /auth/validate` |

## Erros

Toda resposta não-2xx vira um `AuthyonError` (problem+json). Compare pelo `code` legível por máquina, nunca pelo `title`:

```ts
import { AuthyonError, ErrorCodes } from "@authyon/browser";

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
