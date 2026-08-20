# authyon

Monorepo com os SDKs não-oficiais do [Authyon](https://authyon.com), separados por onde cada chave pode rodar com segurança.

| Pacote                                 | Roda em  | Chave                                                    | O que faz                                                                                 |
| -------------------------------------- | -------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`@authyon/auth`](./packages/auth)     | Frontend | publishable (`pk_...`)                                   | Login, 2FA, passkeys, SSO, sessão/refresh automático, organizações, reset de senha        |
| [`@authyon/server`](./packages/server) | Backend  | publishable + OAuth client-credentials (ambiente/tenant) | Verificação de access token (`introspect`/`validate`) e administração de ambiente/tenants |

A publishable key é segura para expor no navegador — ela só acessa os endpoints públicos de auth. As credenciais OAuth client-credentials concedem acesso administrativo (criar tenant, adicionar membro) e **nunca** devem rodar fora do seu servidor; por isso vivem em um pacote separado que não é importável do browser.

Veja [`ARCHITECTURE.md`](./ARCHITECTURE.md) para o porquê dessa divisão e como cada pacote funciona por dentro.

## Setup

```bash
npm install              # instala as dependências de todos os pacotes (npm workspaces)
npm run build             # builda @authyon/auth e @authyon/server
npm run typecheck
npm run lint
npm run format
```

Cada pacote também roda seus próprios scripts (`npm run build` dentro de `packages/auth` ou `packages/server`).

## Documentação

```bash
npm run docs   # gera referência de API (TypeDoc) dos dois pacotes em ./docs
```

## Exemplos

- [`packages/auth/examples`](./packages/auth/examples) — fluxos de frontend (login, 2FA, reset de senha, rotas públicas/privadas)
- [`packages/server/examples`](./packages/server/examples) — fluxos de backend (verificação de token, gestão de organização)
