# Sessão BFF: análise e plano

Base: `dev/jacson` em `e8e288b`, SDKs 0.2.0-beta.4. O cliente já renova tokens; o
entrypoint server/next verifica permissões de um token fornecido pelo consumidor.
Nenhum deles emite ou administra cookies de sessão web.

## Decisão

Adicionar `@authyon/server/bff`, sem mudar os entrypoints atuais. Reutilizar o
transporte HTTP, os erros e a validação database-backed existentes. O BFF guarda
os tokens; o navegador recebe somente um identificador aleatório HttpOnly.
Usar Request/Response da plataforma permite integração com Next Route Handlers
sem adicionar dependência de Next ou React ao BFF.

## Implementação

1. Contrato de armazenamento com compare-and-swap atômico, memória para testes e
   Redis com registros cifrados para múltiplos processos.
2. Provedor com endpoints existentes: login, 2FA, refresh, me, logout e
   switch-tenant. Nenhum endpoint novo é presumido no serviço Authyon.
3. Ciclo de sessão com prazo absoluto e inatividade, renovação sob exclusão
   distribuída, revogação local e publicação conjunta de tokens/perfil de tenant.
4. Handlers com cookie Secure/HttpOnly/SameSite, origem fixa, header anti-CSRF,
   JSON limitado e respostas públicas que nunca serializam tokens.
5. Testes de contrato HTTP simulado, concorrência, indisponibilidade, expiração,
   revogação, isolamento, adulteração do armazenamento e compatibilidade.
6. Documentação de integração, operação e limitações, build/typecheck/lint/testes
   e inspeção do pacote gerado.

## Invariantes e limites

- Um refresh single-use nunca é repetido após resultado de rede ambíguo. O BFF
  invalida a sessão local nesse caso e responde erro de provedor, sem afirmar
  que a credencial foi rejeitada.
- CAS impede gravação tardia depois de logout/expiração. Uma operação travada
  expira e invalida a sessão; nunca libera o refresh token antigo para reuso.
- A aplicação fornece Redis, chave de cifra e origem HTTPS. Memória é somente
  desenvolvimento/teste e não é fallback de produção.
- O consumidor continua responsável por autorização de cada recurso, limites de
  login e limpeza de caches/UI ao trocar tenant. Requisições de negócio já em
  andamento conservam seu contexto de origem.
- Testes simulados não atestam semântica do provedor em produção. Migração do
  MonkeyPay e publicação npm são etapas posteriores e não fazem parte desta
  alteração da biblioteca.

Referências: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
e [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
