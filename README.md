# authyon

Monorepo com os SDKs não-oficiais do [Authyon](https://authyon.com), separados por onde cada chave pode rodar com segurança.

| Pacote                                   | Roda em  | Chave                           | O que faz                                                                             |
| ---------------------------------------- | -------- | ------------------------------- | ------------------------------------------------------------------------------------- |
| [`@authyon/browser`](./packages/browser) | Frontend | publishable (`pk_...`)          | Login, 2FA, sessão/refresh automático, troca de organização, reset de senha           |
| [`@authyon/server`](./packages/server)   | Backend  | publishable + secret (`sk_...`) | Verificação de access token (`introspect`/`validate`) e gestão de organização/membros |

A publishable key é segura para expor no navegador — ela só acessa os endpoints públicos de auth. A secret key concede acesso administrativo (criar organização, adicionar membro) e **nunca** deve rodar fora do seu servidor; por isso vive em um pacote separado que não é importável do browser.

## Setup

```bash
npm install              # instala as dependências de todos os pacotes (npm workspaces)
npm run build             # builda @authyon/browser e @authyon/server
npm run typecheck
npm run lint
npm run format
```

Cada pacote também roda seus próprios scripts (`npm run build` dentro de `packages/browser` ou `packages/server`).

## Exemplos

- [`packages/browser/examples`](./packages/browser/examples) — fluxos de frontend (login, 2FA, reset de senha, rotas públicas/privadas)
- [`packages/server/examples`](./packages/server/examples) — fluxos de backend (verificação de token, gestão de organização)
