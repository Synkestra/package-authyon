# Express

O middleware é compatível com Express sem torná-lo dependência da biblioteca:

```ts
app.get(
  "/reports",
  createExpressAuthorizationMiddleware(authyon, {
    requirement: { action: "read", subject: "reports" },
  }),
  (request, response) => response.json({ userId: request.authyon.userId }),
);
```

Use `passErrorsToNext: true` para centralizar respostas no error middleware. Por padrão, falhas conhecidas retornam JSON com status 401 ou 403.
