# Arquitetura

Como o monorepo é organizado e por quê — para quem for mexer no código, não só usá-lo.

## A divisão central: quem pode segurar qual chave

Tudo neste repo gira em torno de uma pergunta: **essa operação é segura de rodar num navegador que qualquer pessoa controla?**

|            | `@authyon/auth`                                                                | `@authyon/server`                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Roda em    | Frontend (navegador do usuário)                                                   | Seu backend                                                                                                                                            |
| Chave      | Publishable (`pk_...`)                                                            | Publishable **e** secret (`sk_...`)                                                                                                                    |
| Pode fazer | Login, 2FA, refresh, trocar de organização, reset de senha                        | Verificar token (`introspect`/`validate`), criar organização, adicionar/remover membro, atribuir scopes                                                |
| Por quê    | A publishable key só autentica _quem já é_ um usuário — nunca concede acesso novo | A secret key concede acesso administrativo; se vazasse para o browser, qualquer usuário logado poderia se auto-promover a dono de qualquer organização |

Essa é a razão de existirem dois pacotes em vez de um: **não é uma escolha de organização de código, é um limite de segurança**. `@authyon/server` não pode ser importado do browser — não porque o bundler proíba, mas porque a secret key que ele espera receber nunca deve chegar lá.

```
packages/
├── browser/   pk_...           → login, 2FA, sessão, organização (troca), reset de senha
└── server/    pk_... + sk_...  → verificação de token, CRUD de organização/membros
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

**Namespaces** (`user`, `organization`, `twoFactor`): métodos que giram em torno de um recurso ficam agrupados; sessão/auth de alto nível (`login`, `logout`, `refresh`, `introspect`, `validate`) ficam soltos no client, por serem operações do client em si, não de um sub-recurso.

**Invalidação de token** tem três granularidades, cada uma num lugar diferente por design:

- `logout()` — sessão atual (client)
- `logout({ everywhere: true })` — todas as sessões (client)
- `user.revokeSession(id)` — uma sessão específica (namespace `user`, já que opera sobre um recurso — a sessão — não sobre o client como um todo)

## `@authyon/server` — visão interna

```
src/
├── client.ts   AuthyonServerClient — duas chaves, dois conjuntos de operações
├── types.ts    tipos (Organization, User, Member, Invite...)
├── errors.ts   AuthyonError (cópia da mesma classe do browser)
└── index.ts    superfície pública exportada
```

O client aceita `envKey` e `secretKey` **independentemente** — cada método valida em runtime qual delas precisa e lança um erro explícito se faltar, em vez de uma falha de rede confusa. `introspect`/`validate` usam `envKey` (a mesma chave do frontend, não sensível); `organization.*`/`member.*` usam `secretKey`.

A classe `AuthyonError` existe duplicada nos dois pacotes (não extraída para um terceiro pacote `core`) — são ~25 linhas, e um pacote a mais só para isso seria mais complexidade do que o problema justifica para um monorepo de dois pacotes.

> ⚠️ Os endpoints de `organization.*`/`member.*` seguem o padrão REST do restante da API documentada do Authyon, mas não foi possível confirmar nomes exatos de endpoint/campos na doc pública da management API. Ver a mesma ressalva no README de `@authyon/server`.

## Por que os exemplos estão separados por pacote

`packages/browser/examples/` roda só com publishable key; `packages/server/examples/` só roda com secret key/backend. Separá-los por pacote (em vez de uma pasta `examples/` compartilhada, como era antes da migração para monorepo) torna essa fronteira física, não só documental — abrir `packages/server/examples/organization-membership.ts` já deixa claro que aquele código nunca deveria estar num bundle de frontend.

## Build, tipos e docs

- Cada pacote builda para `dist/` via `tsup` (ESM + CJS + `.d.ts`), a partir de um único entry point `src/index.ts`.
- `tsconfig.base.json` na raiz centraliza as opções de compilador comuns; cada pacote estende e ajusta só `lib`/`outDir`. Ambos excluem `examples/` explicitamente do typecheck e do build — os exemplos são verificados à parte (`npx tsc` apontando pra eles diretamente), não fazem parte do pacote publicado (`files: ["dist"]` no `package.json` de cada um já garante isso; o `exclude` no `tsconfig.json` é redundância intencional para deixar isso explícito, não implícito via um `include` estreito).
- `npm run docs` (raiz) gera referência de API combinada dos dois pacotes com TypeDoc em `docs/` (gitignored — é saída gerada, igual a `dist/`), a partir dos comentários JSDoc já presentes no código.

## CI/CD

Ver [`.github/workflows/npm-publish.yaml`](./.github/workflows/npm-publish.yaml) — dispara na criação de uma GitHub Release, versiona os dois pacotes em lockstep a partir da tag, roda typecheck/lint/format/build como gate, publica no npm público e reflete a versão de volta em `package.json` no `main`.
