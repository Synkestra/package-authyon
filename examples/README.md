# Exemplos

Guias de referência para copiar/colar — não são testes automatizados. Os `.ts` importam de `../src/index` (rode contra o código fonte); troque para `@authyon/browser` depois de instalar o pacote publicado.

| Arquivo                                                      | Onde roda               | O que mostra                                                                                                       |
| ------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`auth-flow.ts`](./auth-flow.ts)                             | Frontend                | Registro, login (com 2FA), sessão/refresh automático, troca de organização, revogação de sessão, logout            |
| [`two-factor-setup.ts`](./two-factor-setup.ts)               | Frontend                | Habilitar 2FA (QR code), confirmar, recovery codes, regenerar codes, login via recovery code                       |
| [`password-reset.ts`](./password-reset.ts)                   | Frontend                | Fluxo completo de "esqueci minha senha"                                                                            |
| [`vanilla-login.html`](./vanilla-login.html)                 | Frontend (browser real) | Formulário de login funcional em HTML+JS puro, com tela de 2FA                                                     |
| [`public-private-routes.ts`](./public-private-routes.ts)     | Frontend                | Guard framework-agnostic separando rotas públicas de privadas com `getAccessToken()` / `onAuthStateChange`         |
| [`token-verification.ts`](./token-verification.ts)           | **Backend**             | Middleware validando o access token do frontend — `introspect()` (rápido) vs. `validate()` (cross-checa revogação) |
| [`organization-membership.ts`](./organization-membership.ts) | **Backend**             | Criar organização, adicionar/convidar membros, atribuir scopes — usa a secret key (`sk_...`), nunca o frontend     |

## Frontend vs. backend

A publishable key (`pk_...`) do `@authyon/browser` só acessa os endpoints públicos de auth. Qualquer operação que **concede** acesso (criar organização, adicionar membro, atribuir role/scope) exige a secret key e só pode rodar no seu servidor — por isso `organization-membership.ts` e `token-verification.ts` estão marcados como backend.
