# Revisão de segurança e experiência do cliente

## Resumo executivo

O projeto separa corretamente o SDK de navegador do SDK administrativo, usa credenciais OAuth de curta duração em memória no servidor, codifica parâmetros de rota e não possui vulnerabilidades conhecidas nas dependências de produção segundo `npm audit --omit=dev` em 30/08/2026.

Não foi encontrada uma vulnerabilidade crítica comprovadamente explorável apenas pelo código deste repositório. Os achados abaixo foram corrigidos: tokens usam memória por padrão, URLs remotas exigem HTTPS e `@authyon/server` possui uma barreira explícita contra bundles de navegador.

Além da segurança, a API do SDK pode ajudar mais o cliente com timeout/cancelamento, validação de sessão, estado de autenticação preciso, erros operacionais estruturados e testes automatizados dos fluxos críticos.

## Alta prioridade

### SEC-01 — Tokens persistentes em `localStorage` por padrão (resolvido)

- **Severidade:** Alta
- **Local atual:** `packages/auth/src/session/storage.ts`, `createLocalStorage()` e `createMemoryStorage()`
- **Regra:** armazenamento de tokens no navegador / redução do impacto de XSS
- **Situação atual:** `createDefaultStorage()` usa memória. Persistência exige opt-in explícito com `createLocalStorage()`.
- **Impacto:** um XSS na aplicação que usa o SDK pode ler e exfiltrar o refresh token, mantendo acesso além da vida curta do access token. O risco existe mesmo que o SDK em si não contenha um sink XSS.
- **Correção aplicada:** `createMemoryStorage()` é o padrão seguro. Para proteção mais forte, permanece recomendada uma arquitetura BFF com refresh token em cookie `HttpOnly`, `Secure` e `SameSite`.
- **Mitigação:** documentar CSP estrita, Trusted Types quando viável, ausência de scripts de terceiros desnecessários e rotação/revogação de sessões. Se manter `localStorage` por compatibilidade, exigir opt-in em uma próxima versão major ou emitir aviso de migração.
- **Possível falso positivo:** aplicações consumidoras com CSP forte e nenhum XSS conhecido reduzem a probabilidade, mas não eliminam o impacto caso um XSS surja.

## Média prioridade

### SEC-02 — `baseUrl` permite transporte inseguro e destinos arbitrários

- **Severidade:** Média
- **Local:** `packages/auth/src/client.ts`, construtor e `request()`, linhas 97–104 e 187–208; `packages/server/src/client.ts`, construtor e `request()`, linhas 66–87
- **Evidência:** a opção é apenas normalizada com `.replace(/\/+$/, "")`; não há validação de protocolo ou origem antes de enviar senha, refresh token, access token ou client secret.
- **Impacto:** uma configuração incorreta como `http://...` pode expor credenciais em trânsito; uma URL comprometida ou injetada envia segredos a outro host. No backend, não há a proteção de mixed content presente em muitos navegadores.
- **Correção:** parsear com `new URL()`, exigir `https:` por padrão e permitir `http:` apenas para `localhost`/loopback mediante opção explícita como `allowInsecureHttp`. Falhar cedo com mensagem que não contenha segredos.
- **Mitigação:** documentar que `baseUrl` é configuração confiável e nunca deve vir de input de usuário.
- **Possível falso positivo:** URLs de desenvolvimento HTTP podem ser necessárias; por isso a exceção explícita para loopback evita quebrar esse caso.

### SEC-03 — Separação do pacote server-side é documental, não técnica

- **Severidade:** Média
- **Local:** `packages/server/package.json`, linhas 1–35; `packages/server/src/client.ts`, linhas 51–72
- **Evidência:** o README diz “Nunca importe este pacote em código de browser”, mas o manifesto não possui condição `browser`/stub que faça o build falhar. A implementação usa APIs disponíveis no navegador (`fetch`), então bundlers podem incluí-la sem alerta.
- **Impacto:** uma importação acidental pode incorporar `clientSecret` ao código frontend e expor privilégios administrativos.
- **Correção:** adicionar uma entrada específica para a condição `browser` que lance um erro claro ou bloquear o pacote via campo/exports compatível com os bundlers suportados. Incluir um teste de bundle que prove que a importação client-side falha.
- **Mitigação:** manter exemplos somente com `process.env`, adicionar alerta destacado e regra de lint/documentação para projetos consumidores.
- **Possível falso positivo:** o segredo não está embutido na biblioteca publicada; a exposição só ocorre se o consumidor inicializar o pacote com credenciais no frontend.

### SEC-04 — Sem timeout ou cancelamento nas requisições

- **Severidade:** Média para disponibilidade; Baixa para confidencialidade/integridade
- **Local:** `packages/auth/src/client.ts`, `RequestOptions` e `request()`, linhas 39–45 e 187–208; `packages/server/src/client.ts`, linhas 33–40 e 74–87
- **Evidência:** não há `signal`, `AbortSignal.timeout()` nem timeout configurável nas chamadas a `fetch`.
- **Impacto:** uma API lenta ou indisponível pode deixar requests, renderizações SSR, workers e filas aguardando indefinidamente, degradando a aplicação do cliente e facilitando exaustão de recursos.
- **Correção:** aceitar `signal` por chamada e `timeoutMs` no cliente; combinar sinais com segurança e lançar um erro identificável (`request.timeout` / `request.aborted`).
- **Mitigação:** consumidores podem injetar um `fetch` com timeout, mas isso deveria ser uma capacidade nativa e documentada.

## Baixa prioridade / robustez

### SEC-05 — Sessão lida do storage sem validação de esquema

- **Severidade:** Baixa
- **Local:** `packages/auth/src/storage.ts`, linhas 19–35; `packages/auth/src/client.ts`, linhas 109–132
- **Evidência:** `JSON.parse(raw) as Session` confia no formato persistido sem conferir tokens, tipos numéricos ou expiração.
- **Impacto:** storage corrompido ou adulterado pode produzir estado inconsistente, headers inválidos e loops de refresh. Isso não eleva privilégios no servidor se a API validar tokens corretamente, mas piora previsibilidade e recuperação.
- **Correção:** implementar um type guard/versionamento do payload; rejeitar e apagar entradas inválidas. Nunca registrar o conteúdo inválido.
- **Mitigação:** capturar erros já evita crash durante o parse, mas não cobre JSON válido com formato incorreto.

## Melhorias para auxiliar o cliente

### DX-01 — Estado de autenticação mais fiel

`isAuthenticated()` (`packages/auth/src/client.ts`, linhas 114–116) retorna `true` apenas pela existência da sessão, mesmo expirada. Criar `getAuthState()` com estados como `signed_out`, `authenticated`, `refreshing` e `expired`, ou ao menos verificar `expiresAt`. Isso evita UI mostrar conteúdo autenticado enquanto o primeiro request já falhará.

### DX-02 — Não ocultar a causa de falha no refresh

`getAccessToken()` (`packages/auth/src/client.ts`, linhas 122–132) converte qualquer falha de refresh em `null`. Isso mistura indisponibilidade de rede com logout/credencial revogada. Preservar a sessão em falhas transitórias e disponibilizar a causa por evento/erro; limpar somente em 401/403, como `refresh()` já faz.

### DX-03 — Erros operacionais mais ricos e seguros

`AuthyonError` expõe apenas `status`, `code`, `title` e `detail` (`packages/*/src/errors.ts`, linhas 7–24). Adicionar `requestId`/`traceId`, `retryAfter`, categoria (`network`, `timeout`, `api`, `parse`) e `cause`, sem incluir tokens ou corpo sensível. Isso melhora suporte, observabilidade e retentativas corretas de 429/5xx.

### DX-04 — Retentativas seguras

Implementar retry opcional com jitter apenas para métodos idempotentes e erros transitórios (429/502/503/504), respeitando `Retry-After`. Não repetir automaticamente login, criação ou mutações sem chave de idempotência.

### DX-05 — Sincronização entre abas

Logout e refresh em uma aba não notificam as demais. Usar evento `storage` ou `BroadcastChannel` para propagar `signed_out` e, se a persistência continuar disponível, coordenar refresh entre abas. O single-flight atual funciona somente dentro de uma instância/processo.

### DX-06 — Superfície pública e fluxos não confirmados

Há endpoints documentados no código como inferidos/não confirmados, por exemplo `user.revokeSession()` (`packages/auth/src/client.ts`, linhas 392–406) e métodos tenant no pacote server. Métodos experimentais deveriam ser marcados como tal, protegidos por versão/feature flag ou validados em testes de contrato antes de serem apresentados como estáveis.

### DX-07 — Testes e CI antes de publicar

Não há arquivos de teste no repositório e o workflow de publicação executa typecheck, lint, formatação e build, mas não testes. Adicionar testes unitários e de contrato para rotação single-use, 401 + retry único, 2FA, logout offline, storage corrompido, respostas não JSON, 204, timeout e isolamento entre tenant/environment. Executá-los antes da publicação reduz regressões diretamente sentidas pelo cliente.

### DX-08 — Guia de integração segura

Adicionar uma seção curta e copiável com duas arquiteturas:

1. SPA pura: storage em memória como padrão, CSP, renovação e limitações explícitas.
2. BFF: sessão em cookie `HttpOnly` e tokens nunca expostos ao JavaScript, recomendada para aplicações de maior risco.

Também incluir exemplos de middleware que diferenciem 401 de 403, mapeamento de erros para mensagens localizadas e boas práticas para não registrar passwords, authorization headers, códigos 2FA ou recovery codes.

## Ordem sugerida de implementação

1. Validar `baseUrl` e impedir bundle browser do pacote server-side.
2. Introduzir timeout/cancelamento e erros estruturados, com testes.
3. Adicionar storage validado e estado de autenticação preciso.
4. Planejar a mudança do storage padrão para memória (major version) e publicar o guia SPA/BFF.
5. Sincronizar abas, adicionar retry idempotente e testes de contrato dos endpoints hoje inferidos.
