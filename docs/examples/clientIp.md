# Rastreabilidade do IP real

No browser, chamadas diretas ao Authyon já carregam o IP da conexão e o JavaScript não deve tentar definir `X-Forwarded-For`. Quando a chamada passa pelo seu backend, informe o IP real validado para que o SDK o propague ao Authyon.

## Express

Sem proxy, o middleware usa `request.socket.remoteAddress`. Atrás de um proxy confiável, configure o Express para confiar apenas na sua infraestrutura e habilite a resolução proxy-aware:

```ts
app.set("trust proxy", 1);

app.use(
  createExpressAuthorizationMiddleware(authyon, {
    trustProxy: true,
  }),
);
```

Também é possível controlar totalmente a origem:

```ts
createExpressAuthorizationMiddleware(authyon, {
  resolveClientIp: (request) => trustedInfrastructure.resolveIp(request),
});
```

## Next.js e Web Request

Web `Request` não expõe o socket. Forneça um resolver que leia somente um header sobrescrito pelo seu proxy ou plataforma:

```ts
await authorizeRequest(authyon, request, {
  resolveClientIp: (request) => request.headers.get("x-trusted-client-ip") ?? undefined,
});
```

Para chamadas diretas:

```ts
await authyon.validate(token, { clientIp });
await authyon.introspect(token, { clientIp });
```

O SDK aceita apenas um IPv4 ou IPv6, rejeita listas, whitespace e quebras de linha, e envia o valor em `X-Forwarded-For`. Nunca use cegamente o primeiro valor de um header controlado pela internet: isso permitiria falsificação do IP, comprometendo auditoria e rate limiting.
