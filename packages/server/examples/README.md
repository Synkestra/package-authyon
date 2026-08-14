# Exemplos — @authyon/server

Guias de referência para copiar/colar — não são testes automatizados. Rodam apenas no seu **backend** (nunca no browser). Os `.ts` importam de `../src/index`; troque para `@authyon/server` depois de instalar o pacote publicado.

| Arquivo                                                      | Chave usada            | O que mostra                                                                                                       |
| ------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`token-verification.ts`](./token-verification.ts)           | `envKey` (publishable) | Middleware validando o access token do frontend — `introspect()` (rápido) vs. `validate()` (cross-checa revogação) |
| [`organization-membership.ts`](./organization-membership.ts) | `secretKey`            | Criar organização, adicionar/convidar membros, atribuir scopes                                                     |
