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

### Emitir uma credencial de integração do tenant

Requer o endpoint `POST /env/tenants/{tenantId}/credentials` no backend Authyon
e uma credencial de ambiente com `authyon:credentials:manage`.

```ts
const credential = await authyon.environment.tenants.credentials.create(tenantId, {
  description: "ERP financeiro",
  permissions: ["monkeypay:transactions:read"],
});
// Entregue clientId e clientSecret ao operador: o segredo só é retornado uma vez.
```

As permissões são explícitas e pertencem à integração; não há concessão automática de acesso total.

## Credenciais: paginação, busca e detalhe

```ts
const page = await authyon.environment.tenants.credentials.listPage(tenantId, {
  search: "transactions",
  skip: 0,
  take: 25,
});
const detail = await authyon.environment.tenants.credentials.get(tenantId, credentialId);
```

`page` contém `data`, `perPage` (número da página, começando em 1), `pageSize`,
`total`, `pages`, `hasNext` e `hasPrev`. `take` aceita 1–100 (padrão da API: 25),
`skip` é um deslocamento a partir de zero e `search` aceita até 200 caracteres.
A API pesquisa clientId, descrição e permissões antes de paginar.

O método existente `credentials.list(tenantId)` continua retornando um array:
aceita a resposta antiga e percorre todas as páginas da API atual. Prefira
`listPage` para tabelas ou grandes volumes. A leitura completa detecta páginas
sobrepostas/sem progresso e tem limite de 1.000 páginas; alterações concorrentes
podem exigir reiniciar a leitura, pois a API usa paginação por deslocamento.

O detalhe contém `permissions`, `createdBy` (`id`, `type`, `displayName`),
`createdAt`, `updatedAt`, `lastUsedAt`, `secretRotatedAt`, `revokedAt`, `isActive`,
`expiresAt`, `ageSeconds`, `lifetimeSeconds` e `accessTokenLifetimeSeconds`.
Listagem e detalhe projetam somente campos permitidos, sem segredo ou hash.
Registros antigos podem ter autor e atualização nulos. A credencial atual não
expira automaticamente: `expiresAt` é nulo; `lifetimeSeconds` é nulo enquanto
ativa e representa sua duração até a revogação quando revogada. A validade do
access token é separada (atualmente 1.800 segundos).

## Scopes e ciclo de vida das credenciais

`scopes` é um alias de `permissions` na criação/atualização. Use somente um dos
campos, com uma lista explícita no formato `namespace:resource:action`. O SDK
normaliza espaços, caixa e duplicatas; não concede permissões automaticamente.
A API continua responsável pela autorização. O contrato antigo
`CreateTenantCredentialInput` e chamadas usando `permissions` são preservados.

```ts
const issued = await authyon.environment.tenants.credentials.create(tenantId, {
  description: "ERP financeiro",
  scopes: ["monkeypay:transactions:read"],
});
// Armazene issued.clientSecret no gerenciador de segredos. Não registre a resposta.

// Token de um usuário da plataforma. Pode ser um callback assíncrono que
// consulta a sessão atual a cada operação, sem compartilhar tokens entre usuários.
const platform = authyon.platform(() => getCurrentPlatformAccessToken());
const scope = { workspaceId, environmentId, tenantId };
await platform.credentials.list(scope, { search: "ERP", skip: 0, take: 25 });
await platform.credentials.get(scope, credentialId);
await platform.credentials.create(scope, {
  description: "Leitura",
  permissions: ["monkeypay:transactions:read"],
});
await platform.credentials.updateScopes(scope, credentialId, ["monkeypay:transactions:read"]);
await platform.credentials.updatePermissions(scope, credentialId, {
  permissions: ["monkeypay:transactions:read"],
});
const rotated = await platform.credentials.rotate(scope, credentialId);
await platform.credentials.revoke(scope, credentialId);
```

Omita `tenantId` de `scope` para gerenciar credenciais do ambiente. Criação e
rotação retornam o segredo uma única vez. Alterar permissões substitui a lista
completa. A concessão OAuth continua recebendo apenas `clientId`/`clientSecret`;
`scopes` não é um parâmetro de redução de acesso na troca de token.

Os endpoints `/env` oferecem criação, listagem e detalhe de credenciais do
tenant. Atualização, rotação e revogação usam os endpoints `/platform` com
**token de usuário da plataforma**, sem fallback para credenciais de máquina.
Se a API exigir `auth.step_up_required`, solicite confirmação de senha na sua
aplicação e chame explicitamente `platform.auth.stepUp(currentPassword)` antes
de tentar a operação novamente. O SDK não repete mutações automaticamente.

## Convites e remoção de acesso

### Workspace

```ts
const team = await platform.workspaces.team(workspaceId);
const invite = await platform.workspaces.members.invite(workspaceId, {
  email: "pessoa@example.com",
  role: "auditor", // ou "admin", sempre explícito
});
// invite.acceptUrl é sensível: entregue somente à pessoa convidada.
await platform.workspaces.invites.revoke(workspaceId, invite.inviteId);
await platform.workspaces.members.changeRole(workspaceId, memberId, "auditor");
await platform.workspaces.members.remove(workspaceId, memberId);
```

`memberId` vem de `team.members`, e não é `userId`. O proprietário tem
`memberId: null`; a API protege proprietário, acesso próprio e permissões de
administração. `workspaces.invites.create` é um alias para `members.invite`.
Convites pendentes ficam em `team.pendingInvites`; revogar o convite invalida o
link. Para retirar acesso após aceite, remova o membro.

A pessoa convidada pode consultar/aceitar o convite por uma rota server-side:

```ts
const preview = await authyon.workspaceInvites.preview(invitationToken);
await authyon.workspaceInvites.accept(invitationToken, {
  name: "Pessoa",
  password: registrationPassword,
});
```

Esses métodos não enviam token de usuário nem credenciais de ambiente. Nome e
senha são necessários quando `preview.requiresRegistration` for verdadeiro;
para uma conta existente, use `accept(invitationToken)`.

### Tenant

```ts
const user = authyon.user(() => getCurrentUserAccessToken());
await user.tenants.members.invite(tenantId, {
  email: "pessoa@example.com",
  roles: ["reader"],
});
await user.tenants.members.list(tenantId, { skip: 0, take: 25 });
await user.tenants.members.remove(tenantId, userId);

// Administração por máquina: adicione uma conta existente por ID.
await authyon.environment.tenants.members.add(tenantId, userId, ["reader"]);
await authyon.environment.tenants.members.remove(tenantId, userId);
// Os métodos tenant(credentials).members.add/remove existentes continuam disponíveis.
// Administração com sessão da plataforma:
await platform.tenants.members.add(scope, userId, ["reader"]);
await platform.tenants.members.remove(scope, userId);
```

Configure `envKey` para `user()`. O convite de tenant associa um usuário já
cadastrado no ambiente pelo e-mail; não cria conta e não envia link por e-mail.
A API exige associação/permissões do usuário chamador. No browser, os métodos
existentes `@authyon/auth` → `organization.members.invite/remove` continuam
atendendo esse fluxo. Nunca importe `@authyon/server` no browser.

## Compatibilidade e segurança do transporte

Os métodos anteriores permanecem disponíveis. As novas chamadas exigem os
endpoints atuais da API e a migração `ClientCredentialMetadata` para metadados
persistidos. O SDK não altera o banco nem publica uma versão automaticamente.

O adaptador Fetch agora rejeita redirects para evitar reenviar tokens/segredos;
configure a URL final HTTPS da API. Adaptadores HTTP personalizados devem manter
essa política. Os logs internos omitem corpos/headers e ocultam tokens de
convite presentes no caminho. A auditoria de operações permanece na API; o SDK
não gera eventos duplicados ao consultar listagens de auditoria.
