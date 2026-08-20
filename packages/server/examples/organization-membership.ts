/**
 * Exemplo: gestão de organização (tenant) e membros com @authyon/server.
 *
 * Roda no SEU BACKEND, nunca no browser: essas chamadas usam credenciais
 * OAuth client-credentials de nível ambiente (`clientId`/`clientSecret`,
 * mintadas no console) — o SDK troca por um access token automaticamente
 * (`POST /env/oauth/token`) e o renova sozinho. A publishable key
 * (`envKey`) continua obrigatória em toda chamada, pois seleciona o
 * ambiente (Test/Live); ela sozinha nunca autoriza nada.
 */
import { createClient } from "../src/index";

// clientId/clientSecret de ambiente — carregue de variáveis de ambiente do
// servidor; nunca exponha isso no frontend.
const authyon = createClient({
  envKey: "pk_test_123",
  clientId: "ec_test_123",
  clientSecret: process.env.AUTHYON_CLIENT_SECRET,
});

// ── 1. Criar a organização e o dono inicial ─────────────────────────────────

async function createOrganizationWithOwner(name: string, slug: string, ownerUserId: string) {
  const org = await authyon.environment.tenants.create({ name, slug });
  await authyon.environment.tenants.members.add(org.id, ownerUserId, ["owner"]);
  return org;
}

// ── 2. Adicionar um membro já existente ─────────────────────────────────────

async function addMember(tenantId: string, userId: string, roles: string[] = ["member"]) {
  return authyon.environment.tenants.members.add(tenantId, userId, roles);
}

// ── 3. Ajustar os papéis de um membro já existente ──────────────────────────

async function updateMemberRole(
  tenantId: string,
  userId: string,
  oldRole: string,
  newRole: string,
) {
  await authyon.environment.tenants.members.removeRole(tenantId, userId, oldRole);
  await authyon.environment.tenants.members.assignRole(tenantId, userId, newRole);
}

// ── 4. Remover acesso ────────────────────────────────────────────────────────

async function removeMember(tenantId: string, userId: string) {
  return authyon.environment.tenants.members.remove(tenantId, userId);
}

// ── Exemplo de rotas de backend (Express-like) que o frontend chama ────────

async function handleCreateOrganizationRoute(req: {
  userId: string;
  body: { name: string; slug: string };
}) {
  // req.userId viria de você ter validado o JWT do Authyon nesta requisição
  // (ver token-verification.ts — POST /auth/validate ou verificação local via JWKS).
  const org = await createOrganizationWithOwner(req.body.name, req.body.slug, req.userId);
  return { id: org.id, slug: org.slug };
}

async function handleAddMemberRoute(req: {
  tenantId: string;
  body: { userId: string; roles?: string[] };
}) {
  return addMember(req.tenantId, req.body.userId, req.body.roles);
}

export {
  createOrganizationWithOwner,
  addMember,
  updateMemberRole,
  removeMember,
  handleCreateOrganizationRoute,
  handleAddMemberRoute,
};
