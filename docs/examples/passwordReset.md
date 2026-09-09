# Reset de senha

Código: [`packages/auth/examples/passwordReset.ts`](../../packages/auth/examples/passwordReset.ts).

O primeiro passo solicita um e-mail sem revelar se a conta existe. O segundo confirma o token recebido e define a nova senha:

```ts
await authyon.requestPasswordReset(email);
await authyon.resetPassword({ token, password: newPassword });
```

Apresente sempre uma mensagem neutra após a solicitação para evitar enumeração de usuários.
