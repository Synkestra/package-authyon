# @authyon/server

SDK server-side para o [Authyon](https://authyon.com) — gestão de organizações/membros (secret key) e verificação de access token (publishable key). Nunca importe este pacote em código de browser.

## Instalação

```bash
npm install @authyon/server
```

## Duas chaves, dois conjuntos de operações

| Chave                  | Uso                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `envKey` (`pk_...`)    | Verificar tokens emitidos pelo `@authyon/auth` — `introspect()` / `validate()`. A mesma chave do frontend; não é sensível. |
| `secretKey` (`sk_...`) | Criar/gerenciar organizações e membros. **Nunca** exponha esta chave ao navegador.                                            |

```ts
import { createClient } from "@authyon/server";

const authyon = createClient({
  envKey: process.env.AUTHYON_ENV_KEY, // pk_live_...
  secretKey: process.env.AUTHYON_SECRET_KEY, // sk_live_...
});
```

Cada método valida em runtime que a chave necessária foi passada — chamar `organization.create()` sem `secretKey` lança um erro explicativo, não uma falha silenciosa.

> `@authyon/auth` também exporta um `createClient`. Se algum dia precisar dos dois no mesmo arquivo, use um alias no import: `import { createClient as createServerClient } from "@authyon/server"`.

## Verificação de token

```ts
const { active, sub } = await authyon.introspect(token); // leve
const { user, organization } = await authyon.validate(token); // recomendado — cross-checa revogação
```

Veja [`examples/token-verification.ts`](./examples/token-verification.ts) para um middleware completo.

## Gestão de organização

```ts
const org = await authyon.organization.create({ name: "Acme", slug: "acme" });
await authyon.member.add(org.slug, userId, { role: "owner" });
await authyon.organization.invite(org.slug, { email: "bob@acme.com", role: "member" });
await authyon.member.updateScopes(org.slug, userId, ["billing:read"]);
await authyon.member.remove(org.slug, userId);
```

Veja [`examples/organization-membership.ts`](./examples/organization-membership.ts) para o fluxo completo, incluindo as rotas de backend que o `@authyon/auth` chamaria.

> ⚠️ Os endpoints de `organization.*` / `member.*` seguem o padrão REST do restante da API documentada do Authyon, mas não foi possível confirmar nomes exatos de endpoint/campos na doc pública da management API no momento em que este SDK foi escrito. Confirme no dashboard/API reference antes de depender disso em produção.

## Build

```bash
npm install
npm run build      # dist/ (ESM + CJS + .d.ts via tsup)
npm run typecheck
```
