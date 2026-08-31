# Começando com Authyon

## Escolha do pacote

| Ambiente | Pacote | Credencial | Uso |
| --- | --- | --- | --- |
| Browser, React ou Next.js Client Component | `@authyon/auth` | Publishable key | Login, sessão, usuário, organizações e autorização da interface |
| Next.js Server Component, Route Handler, Express ou backend Node.js | `@authyon/server` | Publishable key ou OAuth client credentials | Validar tokens e executar operações administrativas |

Nunca envie `clientSecret` para o browser. Guards de frontend melhoram a experiência, mas toda operação sensível deve ser autorizada novamente no backend.

## Instalação da beta

```bash
npm install @authyon/auth@beta
npm install @authyon/server@beta
```

Para builds reproduzíveis durante a homologação, fixe a versão:

```bash
npm install --save-exact @authyon/auth@0.2.0-beta.1
npm install --save-exact @authyon/server@0.2.0-beta.1
```

React é peer dependency opcional. Ele só é necessário ao importar `@authyon/auth/react`.

## Browser

```ts
import { createClient } from "@authyon/auth";

export const authyon = createClient({
  baseUrl: "https://api.authyon.com",
  envKey: "pk_live_exemplo",
});
```

O storage padrão é memória. Isso reduz exposição a XSS, mas encerra a sessão local ao recarregar a página. Caso a aplicação escolha persistência, use o adapter documentado, uma política CSP forte e nunca trate criptografia de `localStorage` como proteção contra JavaScript malicioso na mesma origem.

## React e Next.js Client Side

```tsx
"use client";

import { AuthyonProvider, SessionGuard } from "@authyon/auth/react";
import { authyon } from "./authyon";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthyonProvider client={authyon}>
      <SessionGuard loadingFallback={<p>Validando...</p>} fallback={<p>Entre para continuar</p>}>
        {children}
      </SessionGuard>
    </AuthyonProvider>
  );
}
```

O provider não confia imediatamente na sessão local. Ele renova o token quando necessário, consulta `/auth/me`, agenda o próximo refresh e revalida quando a aba volta a ficar visível.

## Backend

```ts
import { createServerClient } from "@authyon/server";

export const authyonServer = createServerClient({
  baseUrl: "https://api.authyon.com",
  envKey: process.env.AUTHYON_PUBLISHABLE_KEY!,
});
```

Para APIs protegidas, valide a assinatura e as claims do bearer token por JWKS. Consulte [validação JWKS](./examples/jwksVerification.md), [Next.js Server Side](./examples/nextServer.md) e [Express](./examples/express.md).

## Próximos passos

- [Autorização completa no React e Next.js](./examples/nextReactAuthorization.md)
- [Abilities e permissões](./examples/authorization.md)
- [HttpAdapter e logger](./examples/httpAdapter.md)
- [Tratamento de erros](./examples/errors.md)
- [Segurança](./security.md)
