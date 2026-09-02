# @authyon/server

SDK server-side para o [Authyon](https://authyon.com) — administração de ambiente/tenants (OAuth client-credentials) e verificação de access token (publishable key). Nunca importe este pacote em código de browser.

## Instalação da beta

```bash
npm install --save-exact @authyon/server@0.2.0-beta.2
```

Durante a beta, `npm install @authyon/server@beta` acompanha o prerelease mais recente. Fixar a versão exata é recomendado para builds reproduzíveis.

O pacote possui uma condição de exportação `browser` que falha imediatamente se um bundler tentar incluí-lo no frontend. URLs remotas exigem HTTPS e cada request tem timeout padrão de 15 segundos, configurável por `timeoutMs`.

O client aceita o mesmo contrato `HttpAdapter` de `@authyon/auth`, útil para tracing, mocks e stacks HTTP próprias:

```ts
import { createClient, FetchHttpAdapter } from "@authyon/server";

const authyon = createClient({
  envKey: process.env.AUTHYON_ENV_KEY,
  httpAdapter: new FetchHttpAdapter(globalThis.fetch),
});
```

Quando houver credenciais, adapter e observabilidade, o builder mantém cada etapa explícita:

```ts
const authyon = new AuthyonServerClientBuilder()
  .withEnvironmentKey(process.env.AUTHYON_ENV_KEY)
  .withEnvironmentCredentials(process.env.AUTHYON_CLIENT_ID, process.env.AUTHYON_CLIENT_SECRET)
  .withHttpLogger(httpLogger)
  .build();
```

O client também aceita `httpLogger: { enabled, logger? }`. A configuração é mutável, portanto `enabled` pode ser alterado em runtime. Os eventos não incluem headers, bodies nem valores de query string, e erros do logger nunca interrompem requests.

`AuthyonError`, `ErrorCodes` e `error.interpret()` também são exportados por este pacote. Use `category`, `action`, `retryable`, `retryAfter` e `requestId` para implementar middleware e observabilidade sem comparar mensagens humanas.

## Validação local com JWKS

Para APIs de alto volume, crie uma vez um verificador com discovery automático:

```ts
const verifier = await authyon.createJwksTokenVerifier({
  audience: process.env.AUTHYON_AUDIENCE,
  algorithms: ["RS256"],
});

const { claims } = await verifier.verifyAccessToken(token);
```

Ele valida assinatura, algoritmo, issuer, audience, tipo e claims temporais, com cache e rotação de chaves. Use `verification: "jwks"` em `authorizeRequest()` ou `createExpressAuthorizationMiddleware()`. Para ações sensíveis que precisam detectar revogação imediatamente, mantenha o padrão `validate`.

## Instalação

```bash
npm install @authyon/server
```

## Chaves e credenciais

| Credencial                             | Uso                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `envKey` (`pk_...`)                    | Selecionado em **toda** chamada via `X-Authyon-Environment` (Test/Live). Não é sensível — é a mesma chave do frontend, mas sozinha não autoriza nada.                                                                                       |
| `clientId` / `clientSecret` (ambiente) | Credenciais OAuth client-credentials de nível ambiente, mintadas no console. O SDK troca por um access token (`POST /env/oauth/token`) e o renova sozinho, usado em todo `environment.*` / `permissions.*`. **Nunca** exponha ao navegador. |
| `clientId` / `clientSecret` (tenant)   | Credenciais por-tenant, usadas via `authyon.tenant({ clientId, clientSecret })` para as chamadas `TenantManagement` (`/tenant/...`).                                                                                                        |

```ts
import { createClient } from "@authyon/server";

const authyon = createClient({
  envKey: process.env.AUTHYON_ENV_KEY, // pk_live_...
  clientId: process.env.AUTHYON_CLIENT_ID, // ec_live_...
  clientSecret: process.env.AUTHYON_CLIENT_SECRET,
});
```

> `@authyon/auth` também exporta um `createClient`. Se algum dia precisar dos dois no mesmo arquivo, use um alias no import: `import { createClient as createServerClient } from "@authyon/server"`.

## Verificação de token

```ts
const { active, sub } = await authyon.introspect(token); // leve
const { user, organization } = await authyon.validate(token); // recomendado — cross-checa revogação
```

Veja [`examples/tokenVerification.ts`](./examples/tokenVerification.ts) para um middleware completo.

## Administração de ambiente (`environment.*`)

Usa as credenciais de ambiente (`clientId`/`clientSecret`) automaticamente — o SDK minta e renova o token sozinho.

```ts
const org = await authyon.environment.tenants.create({ name: "Acme", slug: "acme" });
const tenants = await authyon.environment.tenants.list({
  search: "acme",
  skip: 0,
  take: 20,
});
await authyon.environment.tenants.members.add(org.id, userId, ["owner"]);
await authyon.environment.tenants.members.assignRole(org.id, userId, "billing-admin");
await authyon.environment.tenants.members.remove(org.id, userId);

await authyon.environment.users.list({ search: "acme.com" });
await authyon.environment.roles.create({ name: "support", permissions: ["tickets:read"] });
await authyon.environment.audit.list({ take: 50 });
```

Veja [`examples/organizationMembership.ts`](./examples/organizationMembership.ts) para o fluxo completo, incluindo as rotas de backend que o `@authyon/auth` chamaria.

Namespaces disponíveis: `environment.users`, `environment.tenants` (com `.members` e `.roles` aninhados), `environment.roles`, `environment.permissions`, `environment.audit`.

## Autorização local

`createAuthyonAbility()` transforma o resultado de `validate()`, `introspect()` ou qualquer objeto com `permissions`, `roles` e `scope` em verificações locais no estilo CASL:

```ts
import { createAuthyonAbility } from "@authyon/server";

const identity = await authyon.validate(token);
const ability = createAuthyonAbility(identity);

if (!ability.can("read", "reports")) {
  throw new Error("Forbidden");
}
```

Regras condicionais e de domínio podem ser acrescentadas no segundo argumento. O mecanismo é deny-by-default e não substitui a validação do token nem a autorização aplicada pela API.

### Next.js Server Side

Em Route Handlers, Server Actions ou SSR, mantenha `@authyon/server` em um módulo marcado com `server-only`:

```ts
import "server-only";
import { createAuthorizationErrorResponse, authorizeRequest, createClient } from "@authyon/server";

const authyon = createClient({
  envKey: process.env.AUTHYON_ENV_KEY,
  clientId: process.env.AUTHYON_CLIENT_ID,
  clientSecret: process.env.AUTHYON_CLIENT_SECRET,
});

export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(authyon, request, {
      requirement: { action: "read", subject: "reports" },
    });
    return Response.json({ userId: auth.userId });
  } catch (error) {
    return createAuthorizationErrorResponse(error);
  }
}
```

### Express e frameworks Connect

O middleware não adiciona Express como dependência e disponibiliza `request.authyon`:

```ts
import { createExpressAuthorizationMiddleware } from "@authyon/server";

app.get(
  "/reports",
  createExpressAuthorizationMiddleware(authyon, {
    requirement: { action: "read", subject: "reports" },
  }),
  (request, response) => response.json({ userId: request.authyon.userId }),
);
```

Use `authorizeToken()` em NestJS, Fastify, Hono, tRPC ou integrações próprias. `passErrorsToNext: true` encaminha erros ao middleware de erros do Express.

### IP real do cliente

Chamadas server-side propagam `clientIp` em `X-Forwarded-For`. O middleware Express usa o IP do socket por padrão; atrás de um proxy confiável, configure o próprio Express e use `trustProxy: true`. Para Next.js, passe `resolveClientIp` ao `authorizeRequest()` lendo somente headers que sua infraestrutura sobrescreve. Não confie cegamente em `X-Forwarded-For` recebido da internet.

```ts
await authyon.validate(token, { clientIp: "203.0.113.10" });
```

## Administração por tenant (`tenant()`)

As credenciais de um tenant são próprias dele — use `authyon.tenant(credentials)` para obter um cliente escopado, que minta e cacheia seu próprio token via `POST /tenant/oauth/token`:

```ts
const acme = authyon.tenant({ clientId: acmeClientId, clientSecret: acmeClientSecret });

await acme.members.list();
await acme.members.add(userId, ["member"]);
await acme.roles.create({ name: "viewer", permissions: ["reports:read"] });
```

## Descoberta

```ts
await authyon.discovery.jwks(); // GET /.well-known/jwks.json
await authyon.discovery.openidConfiguration(); // GET /.well-known/openid-configuration
```

## Build

```bash
npm install
npm run build      # dist/ (ESM + CJS + .d.ts via tsup)
npm run typecheck
```
