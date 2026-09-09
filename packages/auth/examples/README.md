# Exemplos — @authyon/auth

Guias de referência para copiar/colar — não são testes automatizados. Os `.ts` importam de `../src/index` (rode contra o código fonte); troque para `@authyon/auth` depois de instalar o pacote publicado.

Todos os exemplos aqui rodam no **frontend** (publishable key). Para gestão de organização/membros e verificação de token no backend, veja [`packages/server/examples`](../../server/examples).

| Arquivo                                                      | O que mostra                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`authFlow.ts`](./authFlow.ts)                               | Registro, login (com 2FA), sessão/refresh automático, troca de organização, revogação de sessão, logout    |
| [`twoFactorSetup.ts`](./twoFactorSetup.ts)                   | Habilitar 2FA (QR code), confirmar, recovery codes, regenerar codes, login via recovery code               |
| [`passwordReset.ts`](./passwordReset.ts)                     | Fluxo completo de "esqueci minha senha"                                                                    |
| [`vanillaLogin.html`](./vanillaLogin.html)                   | Formulário de login funcional em HTML+JS puro, com tela de 2FA                                             |
| [`publicPrivateRoutes.ts`](./publicPrivateRoutes.ts)         | Guard framework-agnostic separando rotas públicas de privadas com `getAccessToken()` / `onAuthStateChange` |
| [`frontend.ts`](./frontend.ts)                               | Login, ability para interface e chamada ao backend com bearer token                                        |
| [`nextReactAuthorization.tsx`](./nextReactAuthorization.tsx) | Provider, refresh automático, validação por `/auth/me` e guards no Next.js/React                           |
