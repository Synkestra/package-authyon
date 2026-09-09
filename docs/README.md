# Guias de uso do Authyon

Esta pasta reúne a referência gerada pelo TypeDoc e a documentação prática dos exemplos. Execute `npm run docs` para atualizar a referência sem remover estes guias.

## Visão geral

- [Começando e matriz de ambientes](./gettingStarted.md)
- [Segurança e checklist de produção](./security.md)
- [Preparação e publicação da beta](./releaseBeta.md)
- [Changelog](../CHANGELOG.md)

## Frontend e autenticação

- [Exemplo completo de frontend](./examples/frontend.md)
- [Fluxo completo de autenticação](./examples/authFlow.md)
- [Reset de senha](./examples/passwordReset.md)
- [Rotas públicas e privadas](./examples/publicPrivateRoutes.md)
- [Configuração de 2FA](./examples/twoFactorSetup.md)
- [Login com JavaScript puro](./examples/vanillaLogin.md)

## Next.js

- [Guia dedicado de Next.js](./nextjs.md)

## Backend e autorização

- [Sessão de navegador no BFF](./bff.md)
- [Análise e plano da sessão BFF](./bff-session-plan.md)
- [Exemplo completo de backend](./examples/backend.md)
- [Verificação de token](./examples/tokenVerification.md)
- [Validação JWT com JWKS](./examples/jwksVerification.md)
- [Gerenciamento de organizações](./examples/organizationMembership.md)
- [Express](./examples/express.md)
- [Abilities e permissões](./examples/authorization.md)

## Infraestrutura

- [Builders](./examples/builders.md)
- [Rastreabilidade do IP real](./examples/clientIp.md)
- [HttpAdapter e logger](./examples/httpAdapter.md)
- [Tratamento de erros](./examples/errors.md)

Credenciais `clientSecret` pertencem exclusivamente ao backend. Verificações de permissionamento no frontend servem para controlar a interface; o backend deve validar novamente toda operação sensível.
