# Exemplos — @authyon/server

Guias de referência para copiar/colar — não são testes automatizados. Rodam apenas no seu **backend** (nunca no browser). Os `.ts` importam de `../src/index`; troque para `@authyon/server` depois de instalar o pacote publicado.

| Arquivo                                                    | Chave usada            | O que mostra                                                                                                       |
| ---------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`tokenVerification.ts`](./tokenVerification.ts)           | `envKey` (publishable) | Middleware validando o access token do frontend — `introspect()` (rápido) vs. `validate()` (cross-checa revogação) |
| [`organizationMembership.ts`](./organizationMembership.ts) | `secretKey`            | Criar organização, adicionar/convidar membros, atribuir scopes                                                     |
| [`backend.ts`](./backend.ts)                               | OAuth de ambiente      | Middleware Express protegendo a API consumida pelo exemplo frontend                                                |
| [`jwksVerification.ts`](./jwksVerification.ts)             | Publishable key        | Assinatura JWT local, claims, discovery, cache e rotação JWKS                                                      |
