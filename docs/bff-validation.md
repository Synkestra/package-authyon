# Validação da sessão BFF

Implementação local na branch `feat/bff-session-transport`, baseada em
`dev/jacson@e8e288b`. Ambiente: Windows, Node 24.20.0. Nenhum pacote foi publicado
e nenhum consumidor foi migrado.

## Escopo entregue

- Entrypoint server-only `@authyon/server/bff`, preservando os entrypoints atuais.
- Login e conclusão de 2FA, cookie opaco HttpOnly, leitura com refresh sob demanda,
  logout e troca de organização. Validação database-backed reutiliza o client server.
- Redis com cifra JWE A256GCM, TTL e CAS; memória para desenvolvimento/testes.
- Proteção CSRF por origem fixa e header obrigatório, corpos limitados, rejeição
  de cookies duplicados e projeção pública sem tokens.
- Testes de concorrência, segregação entre usuários/origens, replay de gravação,
  indisponibilidade, expiração, revogação e publicação conjunta de tenant/tokens.
- Guia do consumidor, plano de implementação e documentação pública gerada.

## Verificações

| Verificação | Resultado |
| --- | --- |
| Baseline antes da alteração | 55 testes passaram |
| Suíte completa após a alteração | 98 testes passaram: 55 existentes e 43 novos |
| `npm run typecheck` | passou nos dois pacotes |
| `npm run lint` | passou |
| `npm run build` | ESM, CJS e declarações dos dois pacotes gerados |
| Importação pública do BFF | ESM/CJS passaram em Node 24; condição browser rejeitada |
| `npm run docs` | passou, incluindo o entrypoint BFF |
| `npm run pack:check` | passou; `bff.js`, `bff.cjs` e declarações presentes |
| `npm audit --omit=dev` | zero vulnerabilidades reportadas |
| Prettier nos arquivos da mudança | passou |
| `git diff --check` | passou |

A execução de cobertura dos 38 primeiros testes novos mediu 93,06% de linhas,
84,73% de branches e 98,68% de funções no bundle `packages/server/dist/bff.js`.
Esse número é do bundle e não equivale à cobertura de todo o repositório. Três
testes adicionais verificam empacotamento/importação. Depois dessa medição, dois
testes de regressão foram adicionados para concorrência sem fila e validação do
registro descriptografado; a porcentagem histórica não foi recalculada.

`npm run check` interrompe na etapa global de Prettier: há terminações CRLF do
checkout Windows em arquivos anteriores à mudança. Mesmo aceitando o estilo de
fim de linha existente (`--end-of-line auto`), quatro arquivos **não alterados**
continuam reprovados: `authyonServerClient.ts`, `credentialManagement.ts`,
`contracts/management.ts` e `tests/credentialManagement.test.mjs`. As etapas
posteriores foram executadas separadamente e passaram. Não foi aplicada uma
reformatação de arquivos alheios ao escopo.

## Limites da evidência

- O adapter Redis mantém os testes rápidos com um double de CAS/TTL e ganhou um
  teste de integração com dois clientes `node-redis`. O CI fornece um Redis real
  e executa o script Lua para comprovar exclusão mútua entre writers, TTL e cifra.
  Sem `AUTHYON_REDIS_TEST_URL`, o teste é ignorado de forma explícita; o Docker
  local continuou indisponível nesta sessão.
- O contrato de rede foi testado com o `HttpAdapter` simulado. Não houve login,
  rotação nem revogação em uma conta real do Authyon nesta implementação.
- Sem publicação npm, rollout, migração MonkeyPay ou QA de browser autenticado.
  Nenhuma aprovação de produção ou encerramento da ADR-003 é implicado.
- O guia enumera os fluxos cobertos; SSO, cadastro e início de login por passkey
  ainda usam os contratos existentes e não foram adicionados aos handlers BFF.

## Próxima validação de adoção

1. Confirmar respostas e semântica do Authyon para login, 2FA, refresh, validate,
   logout e troca de tenant no ambiente de homologação autorizado.
2. Integrar o consumidor, configurar infraestrutura/rate limit e validar UI,
   troca de tenant, expiração, logout e sincronização entre abas.
3. Preparar a versão de release em lockstep. A versão ainda é beta.4 no checkout;
   o pacote atual não deve ser publicado por cima de uma versão já existente.
