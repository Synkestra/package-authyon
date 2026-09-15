# Sessão de navegador no BFF

Recurso implementado no código desta branch; ainda não publicado no npm.
Entrypoint: `@authyon/server/bff`. Use runtime Node.js (validado localmente em
Node 24.20.0); não importe no browser ou
em um runtime Edge.

```text
Navegador -- cookie HttpOnly --> rotas BFF -- Bearer --> APIs
                                   |
                                   +-- Redis: sessão cifrada
                                   +-- Authyon: login/refresh/validate/logout
```

O SDK de browser existente mantém seu contrato. Para adotar este transporte,
o consumidor deve usar os handlers BFF e parar de entregar access/refresh tokens
ao JavaScript. Atualizar o pacote, sozinho, não migra uma aplicação existente.

## Configuração no servidor

O exemplo usa um cliente `redis` já conectado e configuração validada pela
aplicação. A biblioteca não abre conexões Redis nem lê variáveis de ambiente.
Todos os processos do mesmo aplicativo devem usar a mesma origem, prefixo,
chave de cifra e timeouts. Use um prefixo distinto por produto e ambiente.

```ts
import "server-only";
import { createClient } from "@authyon/server";
import { createAuthyonBffProvider, createBffSession, createRedisBffSessionStore } from "@authyon/server/bff";
import { redis } from "./redis";
import { config } from "./config";

const validator = createClient({
  envKey: config.authyonEnvironmentKey,
  clientId: config.authyonClientId,
  clientSecret: config.authyonClientSecret,
});

export const sessions = createBffSession({
  origin: config.appOrigin, // ex.: https://app.example.com, sem barra final
  provider: createAuthyonBffProvider({
    envKey: config.authyonEnvironmentKey,
    validator,
  }),
  store: createRedisBffSessionStore({
    client: redis,
    encryptionKey: config.sessionEncryptionKey, // Uint8Array de 32 bytes aleatórios
    prefix: "monkeypay:production:session:",
  }),
  absoluteTimeoutMs: 8 * 60 * 60 * 1000,
  idleTimeoutMs: 30 * 60 * 1000,
  rememberedSession: {
    absoluteTimeoutMs: 90 * 24 * 60 * 60 * 1000,
    idleTimeoutMs: 30 * 24 * 60 * 60 * 1000,
  },
  refreshAheadMs: 30_000,
});
```

Memória: `createMemoryBffSessionStore()` serve para testes e desenvolvimento em
um processo. Nunca é fallback automático do Redis. Em HTTP local, configure
`origin: "http://localhost:3000"` e `allowInsecureLocalhost: true`. HTTP remoto
continua proibido. Em produção, Redis precisa de controle de acesso, TLS,
limites de memória, política de expiração e disponibilidade compatíveis com a
aplicação. Trocar a chave de cifra invalida as sessões; rotação sem logout não
está implementada.

## Rotas Next.js

Exporte cada handler na rota correspondente. Nenhum handler aceita caminhos
arbitrários do provedor. Todos retornam `Response` com `Cache-Control: no-store`.

```ts
// app/api/session/login/route.ts
import { sessions } from "@/server/sessions";
export const runtime = "nodejs";
export const POST = sessions.login;
```

| Rota sugerida | Export | Handler | Corpo JSON |
| --- | --- | --- | --- |
| `/api/session/login` | POST | `sessions.login` | `email` ou `username`, `password`, `organizationSlug?`, `sessionPersistence?` |
| `/api/session/two-factor` | POST | `sessions.verifyTwoFactor` | `challengeToken`, `method`, `code` ou `webAuthnAssertion`, `sessionPersistence?` |
| `/api/session` | GET | `sessions.session` | nenhum |
| `/api/session/organization` | POST | `sessions.switchOrganization` | `organizationSlug` |
| `/api/session/logout` | POST | `sessions.logout` | nenhum |

O sucesso de login retorna `{ authenticated: true, user, expiresAt }` e emite
`__Host-authyon.session` com `Secure; HttpOnly; SameSite=Lax; Path=/` e Max-Age
limitado ao prazo absoluto. O cookie contém 256 bits aleatórios; o Redis usa um
hash que inclui a origem, e cifra o registro usando JWE A256GCM. O cookie nunca
contém os tokens. Sem atividade, a expiração do Redis pode ocorrer antes da do
cookie; a próxima consulta responde 401 e limpa o cookie.

Uma resposta de desafio 2FA contém somente `twoFactorRequired`, `challengeToken`
e `methods`; não cria sessão. O Authyon continua responsável pela validade e uso
único do desafio. Esta primeira integração não fornece início de SSO, cadastro,
login por passkey ou início de cerimônia WebAuthn; os endpoints existentes do
SDK continuam disponíveis. Não transporte seus resultados com tokens pelo
browser se expandir a integração BFF para esses fluxos.

## Sessão lembrada

O browser pode pedir `sessionPersistence: "remembered"` no login e também na
confirmação 2FA. Isso não escolhe um TTL: o BFF aplica exclusivamente os limites
de `rememberedSession` configurados no servidor. Sem esse campo, a sessão usa os
timeouts existentes de `absoluteTimeoutMs` e `idleTimeoutMs`.

## Browser e CSRF

```ts
const response = await fetch("/api/session/login", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json", "X-Authyon-CSRF": "1" },
  body: JSON.stringify({ email, password }),
});
const state = await response.json();
```

O navegador envia `Origin` automaticamente. Todas as mutações exigem essa
origem exata e `X-Authyon-CSRF: 1`. Este header é uma prova de requisição customizada,
não um segredo: outro site não pode enviá-lo sem preflight CORS, e os handlers
não concedem CORS. Não adicione CORS permissivo sobre essas rotas. Requisições
marcadas `Sec-Fetch-Site: cross-site` são recusadas, inclusive leituras. Proxy
reverso deve preservar a URL pública de `Request`; não há confiança implícita
em `X-Forwarded-Host`. Corpos JSON são limitados a 16 KiB.

O frontend consulta `GET /api/session` para restaurar seu estado. O refresh
acontece sob demanda quando o BFF recebe uma requisição autenticada próxima da
expiração do access token. Não depende de timer do navegador. Sessão ociosa
expira conforme a política, mesmo se a aba continuar aberta.

## Chamadas a APIs protegidas

```ts
export async function GET(request: Request) {
  try {
    const session = await sessions.requireSession(request);
    // Execute aqui a autorização da aplicação antes de acessar o recurso.
    const result = await loadAuthorizedData(session.accessToken);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return sessions.errorResponse(error);
  }
}
```

`requireSession` retorna access token **somente para código do servidor**.
Nunca serialize o resultado completo. A autorização continua sendo verificada
pela API de destino e pela aplicação; o perfil público reduzido não é fonte de
permissões. Mutações que usam `requireSession` também exigem origem e header CSRF.

## Concorrência, tenant e falhas

- CAS reserva a sessão antes de refresh, validação, troca ou logout. Outras
  instâncias aguardam até 2 segundos e então recebem `503 session.busy`.
- A reserva dura no máximo 120 segundos. Após interrupção/crash, a sessão
  expira fechada; um processo atrasado não consegue gravar sobre uma revisão
  nova nem ressuscitar uma sessão removida. Mantenha os timeouts do transporte
  abaixo desse limite. Não há retry automático de concessões de tokens.
- Tokens e perfil são publicados juntos na troca de tenant; valida-se o mesmo
  usuário e o slug solicitado. 403 de tenant mantém a sessão original.
- O identificador de sessão é criado no login e permanece estável durante
  refresh/troca; login com sessão ativa exige logout antes de trocar de usuário.
- A reserva cobre o ciclo de sessão, não toda a execução de negócio. Uma chamada
  já autorizada mantém seu tenant original. A UI deve cancelar consultas e
  limpar caches na troca; esse trabalho do consumidor não é feito pela lib.
- Falha de validação por indisponibilidade preserva a sessão e retorna 503.
  Validação negativa retorna 401 e remove a sessão. 401 nas credenciais de
  máquina do validador é indisponibilidade do provedor, não rejeição do usuário.
- Timeout/erro ambíguo durante refresh ou troca remove a sessão local e retorna
  `503 session.rotation_interrupted`. Não se repete um token possivelmente usado.
  429 recebido antes de emitir tokens preserva a sessão e expõe Retry-After.
- Logout remove a sessão local antes de chamar o Authyon. Se a revogação externa
  falhar, retorna `503 session.upstream_revocation_failed` e apaga o cookie. Isso
  não afirma que tokens já copiados fora do BFF foram revogados no provedor.
- A duração configurada no BFF é um limite local. O upstream pode expirar ou
  revogar antes. A resposta do provedor deve informar `expiresIn`; não há TTL
  inventado quando esse campo está ausente.

## Validação e adoção

Execute `npm test` para regressões e testes de contrato simulado. Os testes do
adaptador Redis verificam cifra, adulteração, TTL e CAS usando um double em
memória; não substituem ensaio com Redis real e múltiplos processos. Valide ainda
login, 2FA, renovação, logout e troca de tenant no ambiente Authyon autorizado,
pois esta implementação não modifica o serviço upstream.

Antes do rollout, configure rate limit de login/2FA, observabilidade sem tokens,
chave de cifra e Redis. Adote o transporte em uma aplicação piloto e valide a
UI autenticada em múltiplas abas. A ADR-003 do MonkeyPay só pode ser encerrada
após essa integração e a evidência de funcionamento com o provedor real.

Referências: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
e [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
