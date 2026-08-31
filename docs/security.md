# Segurança

## Fronteira entre frontend e backend

- Publishable keys podem estar no frontend; `clientSecret`, credenciais OAuth administrativas e tokens de máquina não podem.
- Permissões escondendo botões não protegem uma API. O backend deve verificar token, sessão e permissão em cada operação sensível.
- O pacote `@authyon/server` falha de forma segura no browser, mas segredos também devem permanecer fora de variáveis públicas e bundles.

## Sessão no browser

- O padrão é armazenamento em memória.
- Uma sessão recuperada do storage permanece em `validating` até o `/auth/me` confirmar o usuário.
- Respostas 401 e 403 limpam a sessão. Falhas temporárias mantêm a sessão e expõem `error`, evitando logout incorreto.
- O refresh acontece antes da expiração e é seguido por nova validação do `/auth/me`.
- Criptografar `localStorage` não impede roubo por XSS quando a chave e a descriptografia estão na mesma página. Use CSP, evite HTML não confiável e reduza a persistência.

## Tokens no backend

- Prefira a verificação local por JWKS para cada request.
- Configure issuer e audience esperados; não aceite valores derivados livremente do token.
- Restrinja a lista de algoritmos permitidos.
- O verifier limita tamanho de credencial, valida expiração, tipo e claims, e acompanha rotação pelo `kid`.
- Introspecção remota pode complementar JWKS quando for necessário confirmar revogação imediata.

## IP real

Cabeçalhos encaminhados são controláveis pelo cliente quando não existe um proxy confiável. Só confie em `Forwarded` ou `X-Forwarded-For` quando a topologia estiver configurada explicitamente. Propague ao Authyon apenas o valor validado, sem concatenar uma cadeia fornecida pelo usuário.

## Logs e erros

- O logger é desabilitável e substituível.
- Authorization, cookies, tokens, segredos e corpos sensíveis são sanitizados.
- Use `AuthyonError.code`, `status`, `requestId` e helpers para decisões; não interprete mensagens.
- Não registre objetos de request ou sessão completos em loggers personalizados.

## Checklist de produção

- HTTPS em todos os ambientes remotos.
- CSP restritiva e dependências de frontend auditadas.
- Segredos apenas no backend e no gerenciador de segredos.
- Audience, issuer e algoritmos JWT configurados explicitamente.
- Proxies confiáveis configurados por topologia conhecida.
- Logs com controle de acesso e retenção definida.
- Testes de 401, 403, expiração, rotação JWKS, indisponibilidade e revogação.
- Versão beta fixada exatamente até sua promoção para estável.
