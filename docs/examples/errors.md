# Tratamento de erros

Capture `AuthyonError` e utilize `interpret()` para orientar a interface:

```ts
try {
  await authyon.login(credentials);
} catch (error) {
  if (error instanceof AuthyonError) {
    const interpretation = error.interpret();
    showMessage(interpretation.message);
  }
}
```

Use `code`, `requestId`, `retryAfter`, `category`, `action` e `retryable`. Não mostre detalhes internos ou credenciais ao usuário final.
