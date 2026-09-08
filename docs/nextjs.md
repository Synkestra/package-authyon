# Next.js

Use os dois pacotes em pontos diferentes da aplicação:

| Onde roda | Pacote | Uso |
| --- | --- | --- |
| Client Components | `@authyon/auth` e `@authyon/auth/react` | Login, sessão, refresh automático e guards de interface |
| Server Components, layouts, Route Handlers e Server Actions | `@authyon/server` e `@authyon/server/next` | Validação de token, permissão real e redirects server-side |

## Client Components

```tsx
"use client";

import { AuthyonProvider, PermissionGuard } from "@authyon/auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthyonProvider client={authyon}>{children}</AuthyonProvider>;
}

export function ReportsLink() {
  return (
    <PermissionGuard action="read" subject="reports">
      <a href="/reports">Relatórios</a>
    </PermissionGuard>
  );
}
```

O guard client-side melhora a experiência, mas não substitui validação no servidor.

## Layouts e Server Components

```tsx
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PermissionGuard } from "@authyon/server/next";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get("authyon.access_token")?.value;

  return (
    <PermissionGuard
      client={authyon}
      token={token}
      action="read"
      subject="reports"
      unauthenticatedFallback={() => redirect("/login")}
      forbiddenFallback={<p>Sem permissão para acessar relatórios.</p>}
    >
      {children}
    </PermissionGuard>
  );
}
```

`PermissionGuard` é um Server Component assíncrono. Ele chama `authorizeToken()` ou `authorizeRequest()`, monta a ability com as permissões do usuário e renderiza `children` somente quando `ability.can(action, subject, field)` permitir.

## Route Handlers

```ts
import "server-only";
import { authorizeRequest, createAuthorizationErrorResponse } from "@authyon/server";

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

## Mais Exemplos

- [Next.js Client Side](./examples/nextClient.md)
- [Autorização no Next.js e React](./examples/nextReactAuthorization.md)
- [Next.js Server Side](./examples/nextServer.md)
