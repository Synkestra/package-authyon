# Autorização no Next.js e React

Código: [`packages/auth/examples/nextReactAuthorization.tsx`](../../packages/auth/examples/nextReactAuthorization.tsx).

Importe os recursos React pelo entrypoint dedicado para que aplicações vanilla não carreguem React:

```tsx
"use client";

import { createClient, createMemoryStorage } from "@authyon/auth";
import { AuthyonProvider } from "@authyon/auth/react";

const authyon = createClient({
  envKey: process.env.NEXT_PUBLIC_AUTHYON_ENV_KEY,
  storage: createMemoryStorage(),
  autoRefresh: true,
});

export function Providers({ children }) {
  return <AuthyonProvider client={authyon}>{children}</AuthyonProvider>;
}
```

Adicione o provider uma única vez no layout cliente. Ele executa o seguinte fluxo:

1. lê a sessão local sem considerá-la confiável;
2. renova o access token quando estiver próximo do vencimento;
3. chama `GET /auth/me` para confirmar a sessão e carregar o usuário atual;
4. libera o conteúdo somente depois dessa validação;
5. agenda o próximo refresh;
6. revalida a sessão quando a aba volta a ficar visível;
7. reage automaticamente a login, refresh e logout.

## Proteção de sessão

```tsx
<SessionGuard
  loadingFallback={<Loading />}
  unauthenticatedFallback={<Login />}
  errorFallback={<Retry />}
  onUnauthenticated={() => router.replace("/login")}
>
  <Dashboard />
</SessionGuard>
```

O estado `error` é separado de `unauthenticated`: uma falha temporária de rede não apaga tokens nem força logout. Respostas 401 ou 403 durante refresh ou `/auth/me` invalidam a sessão.

## Proteção por permissão

```tsx
<PermissionGuard
  action="read"
  subject="reports"
  forbiddenFallback={<Forbidden />}
>
  <Reports />
</PermissionGuard>
```

Para lógica programática:

```tsx
const { status, user, session, validateSession, refreshSession } = useAuthyon();
const canEdit = useCan("update", { __type: "documents", authorId: user?.id });
```

`SessionGuard` e `PermissionGuard` protegem a renderização e melhoram a experiência, mas o backend ainda deve validar token e permissão. Em SSR, Route Handlers e Server Actions, use `@authyon/server`.

O storage em memória é o padrão mais seguro. Se a aplicação optar por `createLocalStorage()`, mantenha CSP forte e considere um BFF com cookie `HttpOnly` para cenários de maior risco.
