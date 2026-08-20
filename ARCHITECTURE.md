# Arquitetura

Como o monorepo é organizado e por quê — para quem for mexer no código, não só usá-lo.

## A divisão central: quem pode segurar qual chave

Tudo neste repo gira em torno de uma pergunta: **essa operação é segura de rodar num navegador que qualquer pessoa controla?**

|            | `@authyon/auth`                                                                   | `@authyon/server`                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roda em    | Frontend (navegador do usuário)                                                   | Seu backend                                                                                                                                          |
| Chave      | Publishable (`pk_...`)                                                            | Publishable **e** OAuth client-credentials de ambiente/tenant                                                                                        |
| Pode fazer | Login, 2FA, passkeys, SSO, refresh, trocar de organização, reset de senha         | Verificar token (`introspect`/`validate`), administrar ambiente (usuários, tenants, roles, permissões, audit) e tenants (membros, roles)             |
| Por quê    | A publishable key só autentica _quem já é_ um usuário — nunca concede acesso novo | O client secret concede acesso administrativo; se vazasse para o browser, qualquer usuário logado poderia se auto-promover a dono de qualquer tenant |

Essa é a razão de existirem dois pacotes em vez de um: **não é uma escolha de organização de código, é um limite de segurança**. `@authyon/server` não pode ser importado do browser — não porque o bundler proíba, mas porque o client secret que ele espera receber nunca deve chegar lá.

```
packages/
├── auth/      pk_...                        → login, 2FA, passkeys, SSO, sessão, organização (troca), reset de senha
└── server/    pk_... + OAuth client creds   → verificação de token, administração de ambiente/tenant
```

## `@authyon/auth` — visão interna

```
src/
├── client.ts   AuthyonClient — toda a lógica de rede, sessão e refresh
├── types.ts    tipos públicos (Session, User, Organization, LoginResult...)
├── errors.ts   AuthyonError (problem+json)
├── storage.ts  TokenStorage — localStorage por padrão, memória como fallback
└── index.ts    superfície pública exportada
```

**Sessão e refresh** (`client.ts`): `getAccessToken()` é o ponto de entrada de qualquer chamada autenticada. Ele checa `expiresAt` contra um _skew_ de 30s e, se necessário, chama `refresh()` — que é **single-flight**: chamadas concorrentes durante um refresh compartilham a mesma promise, porque o refresh token da API é single-use/rotacionado e duas chamadas simultâneas queimariam o token uma da outra.

**Normalização tenant → organization** (`normalizeUser` em `client.ts`): a API fala `tenant` no protocolo (`tenantSlug`, `GET /auth/tenants`, `POST /auth/switch-tenant`); o SDK expõe `organization` para quem usa a lib. Toda resposta que carrega um `user` (login, refresh, switch) passa por `normalizeUser` antes de entrar na sessão — inclusive dentro de `refresh()`, que precisa reaproveitar o `user` já normalizado da sessão anterior.

**Namespaces** (`user`, `organization`, `twoFactor`, `webauthn`, `sso`): métodos que giram em torno de um recurso ficam agrupados; sessão/auth de alto nível (`login`, `logout`, `refresh`, `verifyTwoFactor`, `introspect`, `validate`) ficam soltos no client, por serem operações do client em si, não de um sub-recurso.

**Invalidação de token** tem três granularidades, cada uma num lugar diferente por design:

- `logout()` — sessão atual (client)
- `logout({ everywhere: true })` — todas as sessões (client)
- `user.revokeSession(id)` — uma sessão específica (namespace `user`, já que opera sobre um recurso — a sessão — não sobre o client como um todo)

## `@authyon/server` — visão interna

```
src/
├── client.ts   AuthyonServerClient + TenantScopedClient — verificação de token e administração
├── types.ts    tipos (Organization, User, Member, Role, Permission, TokenResult...)
├── errors.ts   AuthyonError (cópia da mesma classe do auth)
└── index.ts    superfície pública exportada
```

A API do Authyon distingue dois "planos" de máquina, cada um com seu próprio par OAuth client-credentials mintado no console:

- **Ambiente** (`clientId`/`clientSecret` passados ao `createClient()`): autentica `environment.*` e `permissions.*`. O client troca essas credenciais por um access token via `POST /env/oauth/token` (`environmentAuth.token()`) e o cacheia/renova sozinho — o mesmo padrão de refresh transparente do `@authyon/auth`, só que sem storage persistente (o token vive em memória, por request/processo).
- **Tenant** (credenciais próprias de cada tenant): autentica `TenantManagement` (`/tenant/...`), que opera sobre "o tenant do token", sem um `tenantId` explícito por chamada. `authyon.tenant({ clientId, clientSecret })` devolve um `TenantScopedClient` com seu próprio cache de token, independente do plano de ambiente.

`introspect`/`validate` usam só `envKey` (a mesma chave do frontend, não sensível) — não exigem nenhum dos dois pares de client-credentials.

O header `X-Authyon-Environment` (a `envKey`) é enviado em **toda** chamada, inclusive nas de administração — ele seleciona o ambiente (Test/Live); quem autoriza a ação é sempre o bearer token.

A classe `AuthyonError` existe duplicada nos dois pacotes (não extraída para um terceiro pacote `core`) — são ~25 linhas, e um pacote a mais só para isso seria mais complexidade do que o problema justifica para um monorepo de dois pacotes.

## Por que os exemplos estão separados por pacote

`packages/auth/examples/` roda só com publishable key; `packages/server/examples/` só roda com client-credentials/backend. Separá-los por pacote (em vez de uma pasta `examples/` compartilhada, como era antes da migração para monorepo) torna essa fronteira física, não só documental — abrir `packages/server/examples/organization-membership.ts` já deixa claro que aquele código nunca deveria estar num bundle de frontend.

## Build, tipos e docs

- Cada pacote builda para `dist/` via `tsup` (ESM + CJS + `.d.ts`), a partir de um único entry point `src/index.ts`.
- `tsconfig.base.json` na raiz centraliza as opções de compilador comuns; cada pacote estende e ajusta só `lib`/`outDir`. Ambos excluem `examples/` explicitamente do typecheck e do build — os exemplos são verificados à parte (`npx tsc` apontando pra eles diretamente), não fazem parte do pacote publicado (`files: ["dist"]` no `package.json` de cada um já garante isso; o `exclude` no `tsconfig.json` é redundância intencional para deixar isso explícito, não implícito via um `include` estreito).
- `npm run docs` (raiz) gera referência de API combinada dos dois pacotes com TypeDoc em `docs/` (gitignored — é saída gerada, igual a `dist/`), a partir dos comentários JSDoc já presentes no código.

## CI/CD

Ver [`.github/workflows/npm-publish.yaml`](./.github/workflows/npm-publish.yaml) — dispara na criação de uma GitHub Release, versiona os dois pacotes em lockstep a partir da tag, roda typecheck/lint/format/build como gate, publica no npm público e reflete a versão de volta em `package.json` no `main`.

O publish é feito **um pacote por vez**, por nome (`npm run publish:auth` / `npm run publish:server`, definidos no `package.json` raiz), nunca com um `npm publish --workspaces` genérico nem um `npm publish` solto na raiz. Motivo: um `npm publish` na raiz do monorepo publica o repo inteiro sob o nome que estiver em `package.json` da raiz — foi exatamente o que aconteceu com `@authyon/auth` 0.1.0–0.1.2 no npm, publicados por engano a partir da raiz enquanto seu `package.json` estava (incorretamente) com `"name": "@authyon/auth"`; essas três versões contêm o monorepo inteiro, sem `dist/`, e nunca podem ser corrigidas — só superadas por uma versão nova. A raiz agora é `"name": "authyon"` / `"private": true`, então um `npm publish` acidental ali falha alto (`EPRIVATE`) em vez de publicar silenciosamente o repo errado.
