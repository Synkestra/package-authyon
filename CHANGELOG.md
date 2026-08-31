# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui. O projeto usa versionamento semântico e mantém `@authyon/auth` e `@authyon/server` na mesma versão.

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
