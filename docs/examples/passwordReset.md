# Reset de senha

Código: [`packages/auth/examples/passwordReset.ts`](../../packages/auth/examples/passwordReset.ts).

## Fluxo padrão: o Authyon envia o e-mail

O primeiro passo solicita um e-mail sem revelar se a conta existe. O segundo confirma o token recebido e define a nova senha:

```ts
await authyon.user.requestPasswordReset(email, {
  // Opcional: para onde mandar a pessoa depois de trocar a senha. Precisa estar
  // cadastrado (match exato) nos redirect URIs do ambiente.
  redirectUri: "https://app.example.com/login",
});

// Na página de redefinição: recuse um link morto antes de pedir a senha.
const preview = await authyon.user.validatePasswordReset(token); // { email, expiresAt, redirectUri }

const done = await authyon.user.confirmPasswordReset(token, newPassword);
if (done.redirectUri) window.location.assign(done.redirectUri); // o redirect fica por sua conta
```

Apresente sempre uma mensagem neutra após a solicitação para evitar enumeração de usuários.

O link vale 30 minutos e uma única vez. Pedir um novo invalida o anterior. Token
desconhecido, usado ou expirado responde `401 user.password_reset.invalid`, tanto na
validação quanto na confirmação.

## Fluxo próprio: a sua aplicação envia o e-mail

No backend, com `@authyon/server` e uma credencial de ambiente com o escopo
`authyon:users:password`, peça só o token e entregue pelo seu próprio e-mail:

```ts
const reset = await authyon.environment.users.issuePasswordReset({
  email,
  redirectUri: "https://app.example.com/login", // opcional, mesma regra acima
  // sendEmail: true faria o Authyon enviar também; o padrão é false.
});

await meuEmail.enviar(reset.email, {
  link: `https://app.example.com/redefinir?token=${encodeURIComponent(reset.token)}`,
  // ou reset.resetUrl, o mesmo link que o e-mail do Authyon levaria
  expiraEm: reset.expiresAt,
});
```

- `token` só aparece nessa resposta; a API guarda apenas o hash. Quem tem o token consegue
  definir a senha: envie somente para o endereço da própria conta e não registre em log.
- Diferente do pedido público, um endereço sem conta responde `404 user.not_found`. A
  sua tela de "esqueci a senha" continua devendo mostrar a mesma mensagem neutra nos dois
  casos.

Na sua página de redefinição, o backend valida e confirma (chamadas públicas, só `envKey`):

```ts
const preview = await authyon.environment.users.validatePasswordReset(token);
const done = await authyon.environment.users.confirmPasswordReset(token, newPassword);
if (done.redirectUri) redirect(done.redirectUri);
```
