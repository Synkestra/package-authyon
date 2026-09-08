# Next.js Server Side

Coloque a configuração em um módulo com `server-only` e use `authorizeRequest()` em Route Handlers:

```ts
import "server-only";
import { authorizeRequest } from "@authyon/server";

const auth = await authorizeRequest(authyon, request, {
  requirement: { action: "read", subject: "reports" },
});
```

Use `authorizeToken()` em Server Actions ou SSR quando já possuir o token. Converta `AuthorizationError` com `createAuthorizationErrorResponse()`.

Em layouts ou páginas com Server Components, importe o guard do entrypoint de Next.js:

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
