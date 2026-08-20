# @authyon/server

SDK server-side para o [Authyon](https://authyon.com) — administração de ambiente/tenants (OAuth client-credentials) e verificação de access token (publishable key). Nunca importe este pacote em código de browser.

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

Veja [`examples/token-verification.ts`](./examples/token-verification.ts) para um middleware completo.

## Administração de ambiente (`environment.*`)

Usa as credenciais de ambiente (`clientId`/`clientSecret`) automaticamente — o SDK minta e renova o token sozinho.

```ts
const org = await authyon.environment.tenants.create({ name: "Acme", slug: "acme" });
await authyon.environment.tenants.members.add(org.id, userId, ["owner"]);
await authyon.environment.tenants.members.assignRole(org.id, userId, "billing-admin");
await authyon.environment.tenants.members.remove(org.id, userId);

await authyon.environment.users.list({ search: "acme.com" });
await authyon.environment.roles.create({ name: "support", permissions: ["tickets:read"] });
await authyon.environment.audit.list({ take: 50 });
```

Veja [`examples/organization-membership.ts`](./examples/organization-membership.ts) para o fluxo completo, incluindo as rotas de backend que o `@authyon/auth` chamaria.

Namespaces disponíveis: `environment.users`, `environment.tenants` (com `.members` e `.roles` aninhados), `environment.roles`, `environment.permissions`, `environment.audit`.

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
