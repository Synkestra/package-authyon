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
