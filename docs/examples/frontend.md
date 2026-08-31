# Exemplo completo de frontend

Código: [`packages/auth/examples/frontend.ts`](../../packages/auth/examples/frontend.ts).

Este exemplo conecta autenticação, permissionamento visual e consumo do backend:

```ts
const result = await authyon.login({ email, password });
const ability = createAuthyonAbility(result.session.user);

if (ability.can("read", "reports")) {
  const token = await authyon.getAccessToken();
  await fetch("/api/reports", {
    headers: { authorization: `Bearer ${token}` },
  });
}
```

Fluxo esperado:

1. O usuário faz login com a publishable key.
2. O SDK mantém e renova a sessão.
3. A ability decide quais controles devem aparecer.
4. `getAccessToken()` entrega o token atualizado para a API.
5. O frontend trata 401 e 403 separadamente.

A ability do frontend melhora a experiência, mas não protege a API. A decisão final acontece no backend.
