# Exemplos — @authyon/browser

Guias de referência para copiar/colar — não são testes automatizados. Os `.ts` importam de `../src/index` (rode contra o código fonte); troque para `@authyon/browser` depois de instalar o pacote publicado.

Todos os exemplos aqui rodam no **frontend** (publishable key). Para gestão de organização/membros e verificação de token no backend, veja [`packages/server/examples`](../../server/examples).

| Arquivo                                                  | O que mostra                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`auth-flow.ts`](./auth-flow.ts)                         | Registro, login (com 2FA), sessão/refresh automático, troca de organização, revogação de sessão, logout    |
| [`two-factor-setup.ts`](./two-factor-setup.ts)           | Habilitar 2FA (QR code), confirmar, recovery codes, regenerar codes, login via recovery code               |
| [`password-reset.ts`](./password-reset.ts)               | Fluxo completo de "esqueci minha senha"                                                                    |
| [`vanilla-login.html`](./vanilla-login.html)             | Formulário de login funcional em HTML+JS puro, com tela de 2FA                                             |
| [`public-private-routes.ts`](./public-private-routes.ts) | Guard framework-agnostic separando rotas públicas de privadas com `getAccessToken()` / `onAuthStateChange` |
