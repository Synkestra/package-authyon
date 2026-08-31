# Next.js Client Side

Em Client Components importe somente `@authyon/auth`:

```tsx
"use client";
import { createAuthyonAbility } from "@authyon/auth";

export function EditButton({ user, document }) {
  const ability = createAuthyonAbility(user);
  return ability.can("update", { __type: "documents", ...document })
    ? <button>Editar</button>
    : null;
}
```

Recrie ou atualize a ability quando a sessão mudar. Não exponha secrets nem confie nesta checagem como autorização final.
