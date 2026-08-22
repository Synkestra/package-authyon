/**
 * Exemplo: como o SEU BACKEND verifica o access token enviado pelo frontend,
 * usando @authyon/server.
 *
 * O @authyon/auth roda no cliente; este arquivo ilustra o lado servidor —
 * ex.: um middleware que protege suas próprias rotas de API usando o token
 * que o frontend manda em `Authorization: Bearer <token>`.
 *
 * Duas estratégias, com trade-offs diferentes:
 *
 * 1. `introspect(token)` — leve, mas não reflete revogação/mudanças recentes
 *    de permissão até o token expirar (JWT stateless).
 * 2. `validate(token)` — "recomendado" pela doc: cross-checa o estado no
 *    banco do Authyon, então detecta revogação/expulsão em tempo real, ao
 *    custo de uma chamada de rede a mais por requisição.
 *
 * Ambas exigem, além da publishable key, uma credencial de cliente de
 * ambiente (`clientId`/`clientSecret`) para autenticar o CHAMADOR — o SDK
 * troca por um token e o anexa sozinho (confirmado contra a API real:
 * sem isso, ambas retornam 401).
 */
import { AuthyonError, createClient } from "../src/index";

const authyon = createClient({
  envKey: "pk_test_123",
  clientId: process.env.AUTHYON_CLIENT_ID,
  clientSecret: process.env.AUTHYON_CLIENT_SECRET,
});

// ── Middleware estilo Express ────────────────────────────────────────────────

interface AuthedRequest {
  headers: Record<string, string | undefined>;
  auth?: { userId: string; permissions: string[] };
}

/**
 * Verificação leve — adequada para rotas de alto volume onde uma revogação
 * levar até `expiresIn` (tipicamente 30 min) para propagar é aceitável.
 */
async function requireAuthFast(req: AuthedRequest): Promise<void> {
  const token = bearerFrom(req);
  const result = await authyon.introspect(token);

  if (!result.active) {
    throw new AuthyonError(401, { code: "auth.invalid_token", title: "Invalid or expired token" });
  }

  req.auth = { userId: result.sub!, permissions: result.scope?.split(" ") ?? [] };
}

/**
 * Verificação forte — use em rotas sensíveis (mudança de senha, dados de
 * pagamento, ações administrativas) onde uma revogação/expulsão recente
 * precisa ser respeitada imediatamente.
 *
 * Confirmado contra a API real: um token inválido/revogado NÃO lança erro
 * aqui — a resposta é 200 OK com `{ valid: false, reason, user: null }`.
 */
async function requireAuthStrict(req: AuthedRequest): Promise<void> {
  const token = bearerFrom(req);
  const { valid, reason, user } = await authyon.validate(token);

  if (!valid || !user) {
    throw new AuthyonError(401, {
      code: reason ?? "auth.invalid_token",
      title: "Invalid, expired or revoked token",
    });
  }

  req.auth = { userId: user.id, permissions: user.permissions ?? [] };
}

function bearerFrom(req: AuthedRequest): string {
  const header = req.headers.authorization ?? "";
  const [, token] = header.split(" ");
  if (!token) {
    throw new AuthyonError(401, {
      code: "auth.missing_token",
      title: "Missing Authorization header",
    });
  }
  return token;
}

// ── Uso ilustrativo ──────────────────────────────────────────────────────────

async function handleSensitiveRoute(req: AuthedRequest) {
  await requireAuthStrict(req);
  console.log("Requisição autenticada para", req.auth);
}

export { requireAuthFast, requireAuthStrict, handleSensitiveRoute };
