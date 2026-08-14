/**
 * Exemplo: como o SEU BACKEND verifica o access token enviado pelo frontend,
 * usando @authyon/server.
 *
 * O @authyon/browser roda no cliente; este arquivo ilustra o lado servidor —
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
 * Ambas usam a PUBLISHABLE key (a mesma do frontend) — verificar um token
 * não exige a secret key, só o CRUD de organização/membros exige.
 */
import { AuthyonError, createServerClient } from "../src/index";

const authyon = createServerClient({ envKey: "pk_test_123" });

// ── Middleware estilo Express ────────────────────────────────────────────────

interface AuthedRequest {
  headers: Record<string, string | undefined>;
  auth?: { userId: string; organizationSlug?: string; permissions: string[] };
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
 */
async function requireAuthStrict(req: AuthedRequest): Promise<void> {
  const token = bearerFrom(req);

  try {
    const { user, organization } = await authyon.validate(token);
    req.auth = {
      userId: user.id,
      organizationSlug: organization?.slug,
      permissions: user.permissions ?? [],
    };
  } catch (err) {
    if (err instanceof AuthyonError && err.status === 401) {
      throw new AuthyonError(401, {
        code: "auth.invalid_token",
        title: "Invalid, expired or revoked token",
      });
    }
    throw err;
  }
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
