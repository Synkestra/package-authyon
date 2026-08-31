# Rotas públicas e privadas

Código: [`packages/auth/examples/publicPrivateRoutes.ts`](../../packages/auth/examples/publicPrivateRoutes.ts).

Use `authState()` para decidir a navegação e `getAccessToken()` antes de chamadas autenticadas. O exemplo demonstra sessão ativa, expirada e usuário deslogado. Proteção no frontend não substitui a validação do bearer token no servidor.
