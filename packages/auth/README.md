# @authyon/auth

SDK JS/TS para o [Authyon](https://authyon.com) — autenticação, sessões, multi-tenant e 2FA, com armazenamento e refresh de tokens transparentes.

Cobre os endpoints públicos do Authyon usando a **publishable key** (`pk_...`) — segura para identificar o ambiente no navegador, sem conceder privilégios administrativos.

Para gestão de organização/membros (secret key) e verificação de token no backend, use `@authyon/server`.

## Instalação

```bash
npm install --save-exact @authyon/auth@0.2.0-beta.4
```

Durante a beta, `npm install @authyon/auth@beta` acompanha o prerelease mais recente. Fixar a versão exata é recomendado para builds reproduzíveis.

## Uso rápido

```ts
import { createClient } from "@authyon/auth";

const authyon = createClient({ envKey: "pk_live_..." }); // tokens somente em memória por padrão

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

## Next.js e React

Use o entrypoint dedicado `@authyon/auth/react`:

```tsx
<AuthyonProvider client={authyon}>
  <SessionGuard loadingFallback={<Loading />}>
    <PermissionGuard action="read" subject="reports">
      <Reports />
    </PermissionGuard>
  </SessionGuard>
</AuthyonProvider>
```

O provider faz refresh automático, valida a sessão por `GET /auth/me`, atualiza usuário e permissions, revalida quando a aba volta ao foco e não libera guards enquanto a validação inicial estiver pendente. Use `useAuthyon()`, `useAuthyonAbility()` e `useCan()` para fluxos programáticos.

Use `transformUser` para expor campos derivados sem alterar a sessão mantida pela lib:

```tsx
type ApplicationUser = User & { fullName: string };

<AuthyonProvider<ApplicationUser>
  client={authyon}
  transformUser={(user) => ({
    ...user,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(" "),
  })}
>
  <App />
</AuthyonProvider>;

const { user, session } = useAuthyon<ApplicationUser>();
```

O usuário transformado é retornado em `user` e em `session.user` após validação, refresh, login e troca de organização. O transformador deve ser puro e só derivar dados do perfil do Authyon; dados externos pertencem ao contexto da aplicação.

Para configuração progressiva, use o builder:

```ts
const authyon = new AuthyonClientBuilder("pk_live_...")
  .withStorage(createMemoryStorage())
  .withTimeout(10_000)
  .build();
```

## Sessão e tokens

- Tokens ficam somente em memória por padrão, reduzindo o impacto de XSS e sendo removidos ao recarregar a página.
- Persistência é opt-in com `storage: createLocalStorage()`. Isso melhora conveniência, mas qualquer XSS na aplicação poderá ler os tokens; criptografar o valor não elimina esse risco porque o JavaScript também precisa acessar a chave.
- `getAccessToken()` renova o token automaticamente antes de expirar (refresh token é single-use e rotacionado, com single-flight para evitar corridas).
- Chamadas autenticadas que retornam 401 fazem um refresh e uma retentativa automática.

```ts
import { createClient, createLocalStorage } from "@authyon/auth";

// Use somente quando a persistência for um requisito aceito conscientemente.
const persistentClient = createClient({
  envKey: "pk_live_...",
  storage: createLocalStorage(),
});

const token = await authyon.getAccessToken(); // sempre válido, ou null se deslogado

const unsubscribe = authyon.onAuthStateChange((event) => {
  // "signed_in" | "refreshed" | "signed_out"
  console.log(event.type);
});
```

Para aplicações de maior risco, prefira um BFF que mantenha o refresh token em cookie `HttpOnly`, `Secure` e `SameSite`, com proteção CSRF. O SDK também exige HTTPS para APIs remotas e aplica timeout de 15 segundos por padrão (`timeoutMs: 0` desabilita).

## HTTP Adapter

Use `httpAdapter` para integrar mocks, tracing ou outra biblioteca HTTP. O mesmo contrato está disponível em `@authyon/auth` e `@authyon/server`:

```ts
import { createClient, type HttpAdapter } from "@authyon/auth";

const httpAdapter: HttpAdapter = {
  async request(request) {
    // tracing, métricas ou adaptação para sua stack HTTP
    return fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
  },
};

const authyon = createClient({ envKey: "pk_live_...", httpAdapter });
```

`FetchHttpAdapter` é a implementação padrão e também pode encapsular um `fetch` customizado. Não configure `httpAdapter` e `fetch` ao mesmo tempo.

O logger HTTP é desabilitado por padrão. Passe uma configuração mutável para observar e manipular eventos de request, response e erro; altere `enabled` a qualquer momento sem recriar o client:

```ts
import { createClient, type HttpLoggerOptions } from "@authyon/auth";

const httpLogger: HttpLoggerOptions = {
  enabled: true,
  logger(event) {
    observability.track(event.type, event);
  },
};

const authyon = createClient({ envKey: "pk_live_...", httpLogger });

httpLogger.enabled = false; // desabilita
httpLogger.enabled = true; // habilita novamente
```

Sem um `logger` customizado, os eventos usam `console.debug`. Headers, bodies e valores de query string são removidos dos eventos para evitar vazamento de tokens, senhas e dados pessoais. Falhas do logger são isoladas e não interrompem a autenticação. Para decorar um adapter manualmente, use `LoggingHttpAdapter`.

## API

## Autorização baseada em permissões

Crie uma ability diretamente do usuário da sessão. Permissões Authyon seguem `subject:action`, por exemplo `tickets:read` e `documents:update`:

```ts
import { createAuthyonAbility } from "@authyon/auth";

const ability = createAuthyonAbility(session.user, {
  rules: [
    {
      action: "update",
      subject: "documents",
      inverted: true,
      conditions: { locked: true },
      reason: "Documento bloqueado",
    },
  ],
});

ability.can("read", "tickets");
ability.can("update", { __type: "documents", locked: false });
ability.cannot("update", { __type: "documents", locked: true });
```

Também estão disponíveis `AuthyonAbilityBuilder`, regras por role, campos, condições com operadores (`$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$exists`, `$and`, `$or`), `rulesFor()`, `update()` e o evento `updated`. A autorização é local e nega por padrão; o backend continua responsável por validar toda ação sensível.

### Next.js Client Side

`@authyon/auth` e o motor de abilities são isomórficos e podem ser usados em Client Components:

```tsx
"use client";

import { createAuthyonAbility } from "@authyon/auth";

export function EditButton({ user, document }) {
  const ability = createAuthyonAbility(user);
  if (ability.cannot("update", { __type: "documents", ...document })) return null;
  return <button>Editar</button>;
}
```

Essa verificação controla a interface, não a segurança do backend. Nunca importe `@authyon/server` em Client Components nem envie `clientSecret` ao navegador.

Métodos de sessão/auth ficam soltos no client; os que giram em torno de um recurso específico ficam agrupados em namespaces (`user`, `organization`, `twoFactor`, `webauthn`, `sso`).

| Método                                                                   | Endpoint                          |
| ------------------------------------------------------------------------ | --------------------------------- |
| `register({ email, username, password })`                                | `POST /auth/register`             |
| `login({ email \| username, password, organizationSlug? })`              | `POST /auth/login`                |
| `verifyTwoFactor({ challengeToken, method, code?, webAuthnAssertion? })` | `POST /auth/2fa/verify`           |
| `refresh()`                                                              | `POST /auth/refresh`              |
| `logout({ everywhere? })`                                                | `POST /auth/logout`               |
| `introspect(token?)`                                                     | Deprecated: use `@authyon/server` |
| `validate(token?)`                                                       | Deprecated: use `@authyon/server` |

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
| `organization.list({ search?, skip?, take? })`        | `GET /auth/tenants`                            |
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

Falhas de transporte usam `request.network_error` ou `request.timeout`. Quando presentes, `requestId` e `retryAfter` ajudam suporte e tratamento de rate limit sem expor o corpo da requisição.

`interpret()` converte códigos e status em uma decisão estável para a interface:

```ts
try {
  await authyon.login({ email, password });
} catch (cause) {
  if (!(cause instanceof AuthyonError)) throw cause;
  const { category, action, retryable, retryAfter } = cause.interpret();
  // category: authentication | validation | rate_limit | network | ...
  // action: reauthenticate | fix_input | retry | ...
}
```

Veja o catálogo completo em `ERRORS.md` no repositório.

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
