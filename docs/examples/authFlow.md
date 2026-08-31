# Fluxo completo de autenticação

Código: [`packages/auth/examples/authFlow.ts`](../../packages/auth/examples/authFlow.ts).

Use como referência para registro, login, desafio 2FA, leitura da sessão, refresh e logout. Configure uma publishable key e mantenha o storage em memória por padrão:

```ts
const authyon = createClient({ envKey: "pk_live_..." });
const result = await authyon.login({ email, password });
if (!result.twoFactorRequired) console.log(result.session.user);
```

Nunca coloque `clientSecret` neste fluxo.
