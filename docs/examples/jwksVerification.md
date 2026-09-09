# Validação JWT com JWKS

Código: [`packages/server/examples/jwksVerification.ts`](../../packages/server/examples/jwksVerification.ts).

Crie o verificador uma vez durante o startup. O SDK busca o documento OpenID do ambiente, vincula issuer e JWKS ao mesmo origin HTTPS e mantém as chaves em cache:

```ts
const authyon = createClient({ envKey: process.env.AUTHYON_ENV_KEY });

const verifier = await authyon.createJwksTokenVerifier({
  audience: process.env.AUTHYON_AUDIENCE,
  algorithms: ["RS256"],
});

const { claims, protectedHeader } = await verifier.verifyAccessToken(token);
```

O verificador exige assinatura válida, algoritmo assimétrico permitido, `iss`, `aud`, `sub`, `exp`, `iat`, `nbf` quando presente, idade máxima e `typ` igual a `JWT` ou `at+jwt`. Roles, permissions, scope e tamanho da credencial também são validados.

O JWKS remoto usa timeout de 5 segundos, cache de 10 minutos e cooldown de 30 segundos. Todos são configuráveis e a rotação por `kid` é automática.

## Express

```ts
app.use(
  createExpressAuthorizationMiddleware(authyon, {
    verification: "jwks",
    jwksVerifier: verifier,
    requirement: { action: "read", subject: "reports" },
  }),
);
```

## Next.js

```ts
const authorization = await authorizeRequest(authyon, request, {
  verification: "jwks",
  jwksVerifier: verifier,
  requirement: { action: "read", subject: "reports" },
  resolveClientIp: trustedIpResolver,
});
```

## Escolha do modo

- `jwks`: rápido e local; não detecta revogação antes do token expirar.
- `introspect`: consulta o Authyon e retorna a identidade do endpoint.
- `validate`: indicado para operações críticas, pois confirma revogação e estado atual no banco.

Não use decode sem assinatura, não derive `jwksUri` de `jku` ou `x5u` do token e não permita `HS256` com uma chave pública. Consulte o [JWT Best Current Practices, RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html) e a documentação de JWKS remoto da [`jose`](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md).
