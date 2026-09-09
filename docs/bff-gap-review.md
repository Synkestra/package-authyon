# Mapa de gaps da sessão BFF

Revisão da branch `feat/bff-session-transport` contra `origin/dev/jacson@e8e288b`,
feita antes das correções finais. O trabalho do Nival é a base: nenhum arquivo-fonte
existente de `packages/auth`, `internal` ou dos clientes e contratos atuais de
`packages/server` foi alterado pela extensão BFF.

## Resultado do mapeamento

| ID | Área | Estado antes da correção | Tratamento |
| --- | --- | --- | --- |
| GAP-01 | Base Git | Resolvido | A branch contém a `origin/main` atual por meio da `dev/jacson`; a `main` local foi alinhada sem descartar o histórico divergente, preservado em uma branch de backup. |
| GAP-02 | Limite de responsabilidade | Resolvido | O BFF é aditivo e exportado apenas por `@authyon/server/bff`; não substitui o controlador automático de navegador do Nival. |
| GAP-03 | Acoplamento entre pacotes | Resolvido | Tipos de entrada do BFF deixaram de importar arquivos internos de `packages/auth`. |
| GAP-04 | Expiração da cifra | Resolvido | O Redis e os limites absoluto/ocioso são a fonte do prazo; a JWE protege o conteúdo sem manter um segundo relógio de expiração. |
| GAP-05 | Concorrência em leituras | Correção local necessária | Leituras comuns reservavam a sessão durante a validação no provedor, enfileirando requisições paralelas do mesmo navegador. |
| GAP-06 | Dados vindos do Redis | Correção local necessária | Uma JWE íntegra, mas com estrutura inesperada, podia atravessar o limite de persistência sem validação de formato. |
| GAP-07 | Redis real | Resolvido no CI | Um Redis de serviço recebe dois clientes independentes; o teste executa o Lua e comprova CAS concorrente, TTL, cifra e exclusão. |
| GAP-08 | Authyon real | Validação externa pendente | Falta confirmar login, 2FA, refresh, validate, logout e troca de tenant em homologação autorizada. |
| GAP-09 | Consumidor MonkeyPay | Adoção pendente | A biblioteca ainda não foi integrada nem validada no navegador autenticado do MonkeyPay. |
| GAP-10 | Release | Etapa de publicação | A versão continua beta.4; deve ser atualizada apenas no fluxo de release, sem sobrescrever pacote publicado. |
| GAP-11 | SSO, cadastro e passkey inicial | Fora do primeiro recorte | Esses fluxos continuam nos contratos existentes e não possuem handlers BFF nesta entrega. |
| GAP-12 | Prettier global | Dívida anterior preservada | Arquivos não relacionados continuam com divergências; não serão reformatados junto com esta mudança. |
| GAP-13 | Operação | Adoção pendente | Rate limit, métricas, alertas e chaves de cifra pertencem à configuração do consumidor e da infraestrutura. |

## Critério para subir a branch

Os GAP-05 e GAP-06 precisam ser corrigidos e cobertos por testes. A branch pode ser
enviada para revisão quando typecheck, lint, build, testes, documentação,
empacotamento, auditoria de dependências e verificação de diff passarem. Os gaps
externos permanecem explicitamente abertos: um push não equivale a publicar npm,
integrar o MonkeyPay ou concluir a ADR-003.

## Correções aplicadas depois do mapeamento

- **GAP-05 corrigido:** leituras válidas usam uma fotografia otimista da sessão e
  atualizam o prazo ocioso por CAS. Renovação, troca de tenant e logout continuam
  protegidos por reserva exclusiva, mantendo a rotação de refresh em instância única.
- **GAP-06 corrigido:** o adapter Redis agora valida em tempo de execução toda a
  estrutura da sessão descriptografada e falha fechado com
  `session.storage_invalid` quando encontra dados incompatíveis.

Os testes novos demonstram três validações comuns simultâneas, uma única renovação
concorrente e rejeição de uma JWE válida que contém uma sessão malformada.
O teste de integração Redis usa dois clientes reais contra a mesma chave e exige
que somente um writer concorrente consiga avançar a revisão.
