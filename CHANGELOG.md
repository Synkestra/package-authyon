# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui. O projeto usa versionamento semântico e mantém `@authyon/auth` e `@authyon/server` na mesma versão.

## Não publicado

- Entrypoint `@authyon/server/bff` com handlers Fetch para login, 2FA, leitura da sessão,
  logout e troca de organização; cookies HttpOnly, origem estrita e proteção CSRF.
- Login e 2FA do BFF aceitam a seleção explícita de sessão lembrada, mantida somente no
  servidor com prazos absoluto e de inatividade configuráveis. O indicador nunca é enviado
  ao Authyon upstream; logout e revogação continuam invalidando a sessão local.
- Sessões com prazo absoluto/inatividade, renovação sob demanda e CAS para impedir
  refresh concorrente, gravação tardia e restauração de sessão após logout.
- Adaptadores de sessão em memória (desenvolvimento) e Redis com cifra A256GCM,
  TTL e associação criptográfica à chave da sessão. Sem nova dependência de runtime.
- Guia de integração e testes de segurança/concorrência. O transporte é opt-in;
  consumidores existentes continuam usando seus contratos atuais.

## 0.2.0-beta.8

### Adicionado

- `hasPermissionGroup()` em `@authyon/auth` e `@authyon/server`, com suporte a grupos `allOf` e `anyOf`.
- `environment.tenants.disable()` no `@authyon/server` para desativar um tenant sem remover seus dados.

### Alterado

- Formatação dos contratos e testes de gerenciamento de credenciais.

## 0.2.0-beta.7

### Alterado

- `organization.list()` no `@authyon/auth` agora aceita `search`, `skip` e `take`.

## 0.2.0-beta.5

### Adicionado

- `TenantScopedClient.validate()` no `@authyon/server`, chamando `POST /tenant/auth/validate` para confirmar o bearer tenant-client atual e retornar o escopo vigente da credencial.

## 0.2.0-beta.4

### Adicionado

- Entry point `@authyon/server/next` com `PermissionGuard` server-side para uso em layouts e páginas do Next.js.
- Guia dedicado de Next.js reunindo Client Components, Route Handlers, Server Actions e proteção de layout.

### Alterado

- `@authyon/auth` e `@authyon/server` voltam a ser preparados em lockstep para publicação.

## 0.2.0-beta.3

- Credenciais de tenant com `listPage`, busca combinada e `get` seguro; `list` mantém o retorno em array, inclusive na API paginada.
- Alias explícito `scopes` para permissões de credenciais, preservando o contrato `permissions`.
- Contextos isolados `platform(token)` e `user(token)` para administração de credenciais, convites e remoção de membros.
- Equipe de workspace, convite, revogação, alteração de papel e aceite de convite.
- Listagem/detalhe de credenciais com projeção de campos permitidos; tokens de convite ocultos nos logs.
- Fetch rejeita redirects; configure a URL final da API. Tokens de máquina e segredo do cliente/builder ficam em campos privados em runtime.
- Testes de compatibilidade, paginação, autorização, scopes, membros e segurança do transporte.

## 0.2.0-beta.2

### Alterado

- `environment.tenants.list()` agora aceita `search`, `skip` e `take` e retorna a paginação padronizada `Paged<Organization>`.

## 0.2.0-beta.1

Republicação da beta com a versão corrigida. Mantém as funcionalidades e correções descritas abaixo para a nova rodada de homologação.

## 0.2.0-beta.0

Primeira beta da nova arquitetura do SDK. Esta versão é indicada para homologação antes da promoção para `latest`.

### Adicionado

- Fluxo React e Next.js com `AuthyonProvider`, hooks, guards, auto refresh e validação da sessão por `/auth/me`.
- Controlador de sessão independente de framework.
- Autorização baseada em abilities, com builder semelhante ao CASL, condições, campos e regras invertidas.
- Integrações para Next.js Server Side, Fetch API e Express.
- Verificação JWT local por JWKS, discovery OpenID, cache, rotação de chaves e validação obrigatória de claims.
- `HttpAdapter` compartilhado, logger configurável e sanitização de dados sensíveis.
- Extração segura do IP real com configuração explícita de proxies confiáveis.
- Hierarquia estruturada de erros com códigos, metadados operacionais e helpers para o cliente.
- Builders para configuração progressiva dos clientes.
- Exemplos completos de frontend e backend em `/docs/examples`.

### Alterado

- Código reorganizado em módulos por responsabilidade e internos compartilhados.
- APIs exclusivas de servidor foram removidas do pacote de browser.
- Paginação padronizada com a nomenclatura `Paged`.
- Nomes próprios do projeto seguem camelCase, sem hífens.
- Storage padrão passou a ser somente memória; persistência no navegador exige escolha explícita.

### Segurança

- Sessões persistidas deixam de ser confiadas antes da confirmação pela API Authyon.
- Falhas transitórias de rede não são interpretadas automaticamente como logout.
- URLs remotas inseguras, algoritmos JWT não permitidos, claims inválidas e credenciais grandes demais são rejeitados.
- Tokens, segredos, cookies e cabeçalhos sensíveis são removidos dos logs e erros.

### Nota de beta

As APIs públicas estão prontas para integração, mas podem receber ajustes compatíveis com o feedback da homologação. Fixe a versão exata em produção durante a beta.
