# Exemplo completo de backend

Código: [`packages/server/examples/backend.ts`](../../packages/server/examples/backend.ts).

O backend recebe o token enviado pelo frontend, valida sua situação atual no Authyon e exige `reports:read`:

```ts
const authyon = createClient({
  envKey: process.env.AUTHYON_ENV_KEY,
  clientId: process.env.AUTHYON_CLIENT_ID,
  clientSecret: process.env.AUTHYON_CLIENT_SECRET,
});

app.get(
  "/api/reports",
  createExpressAuthorizationMiddleware(authyon, {
    requirement: { action: "read", subject: "reports" },
  }),
  (request, response) => response.json(loadReports(request.authyon.userId)),
);
```

O middleware retorna 401 para token ausente ou inválido e 403 para usuário autenticado sem permissão. Depois da autorização, `request.authyon` contém `userId`, permissions, roles e ability.

O middleware também propaga o IP do socket. Atrás de proxy, configure `trust proxy` no Express e passe `trustProxy: true`; veja [Rastreabilidade do IP real](./clientIp.md).

As variáveis `AUTHYON_CLIENT_ID` e `AUTHYON_CLIENT_SECRET` nunca podem usar prefixos públicos como `NEXT_PUBLIC_` nem chegar ao bundle do frontend.
