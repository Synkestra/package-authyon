# Verificação de token

Código: [`packages/server/examples/tokenVerification.ts`](../../packages/server/examples/tokenVerification.ts).

Use `validate()` quando revogação imediata e estado atual do usuário forem necessários. `introspect()` também pode fornecer scopes, roles e permissões:

```ts
const result = await authyon.validate(token);
if (!result.valid || !result.user) throw new Error("Unauthorized");
```

Extraia tokens somente do header `Authorization: Bearer` e nunca os inclua em logs.
