/**
 * Exemplo: gestão de organização/membros com @authyon/server.
 *
 * Roda no SEU BACKEND, nunca no browser: criar uma organização e atribuir
 * scopes/roles são operações de "server-to-server management API", que
 * exigem a SECRET KEY (`sk_...`). A publishable key (`pk_...`) usada pelo
 * @authyon/browser só acessa os endpoints públicos de auth (login, 2FA,
 * refresh, etc.) — ela nunca deve conseguir conceder acesso a uma organização
 * sozinha, senão qualquer pessoa no navegador poderia se auto-promover.
 *
 * ⚠️ Os paths/campos usados por `authyon.organization.*` e `authyon.member.*`
 * seguem o padrão REST do restante da API documentada, mas não consegui
 * abrir a página de "API reference" da management API para confirmar nomes
 * exatos de endpoint no momento em que este SDK foi escrito. Confirme no
 * dashboard/API reference do Authyon antes de usar em produção.
 */
import { createServerClient } from "../src/index";

// sk_live_... — carregue de uma variável de ambiente do servidor; nunca exponha isso no frontend
const authyon = createServerClient({ secretKey: "sk_test_123" });

// ── 1. Criar a organização e o dono inicial ─────────────────────────────────

async function createOrganizationWithOwner(name: string, slug: string, ownerUserId: string) {
  const org = await authyon.organization.create({ name, slug });
  await authyon.member.add(org.slug, ownerUserId, { role: "owner" });
  return org;
}

// ── 2. Convidar por e-mail (usuário ainda não existe / ainda não é membro) ──

async function inviteToOrganization(organizationSlug: string, email: string, role = "member") {
  // Fluxo comum: cria um convite que o usuário aceita depois de logado.
  return authyon.organization.invite(organizationSlug, { email, role });
}

// ── 3. Ajustar scopes de um membro já existente ─────────────────────────────

async function updateMemberScopes(organizationSlug: string, userId: string, scopes: string[]) {
  return authyon.member.updateScopes(organizationSlug, userId, scopes);
}

// ── 4. Remover acesso ────────────────────────────────────────────────────────

async function removeMember(organizationSlug: string, userId: string) {
  return authyon.member.remove(organizationSlug, userId);
}

// ── Exemplo de rotas de backend (Express-like) que o frontend chama ────────

async function handleCreateOrganizationRoute(req: {
  userId: string;
  body: { name: string; slug: string };
}) {
  // req.userId viria de você ter validado o JWT do Authyon nesta requisição
  // (ver token-verification.ts — POST /auth/validate ou verificação local via JWKS).
  const org = await createOrganizationWithOwner(req.body.name, req.body.slug, req.userId);
  return { slug: org.slug };
}

async function handleInviteRoute(req: {
  organizationSlug: string;
  body: { email: string; role?: string };
}) {
  return inviteToOrganization(req.organizationSlug, req.body.email, req.body.role);
}

export {
  createOrganizationWithOwner,
  inviteToOrganization,
  updateMemberScopes,
  removeMember,
  handleCreateOrganizationRoute,
  handleInviteRoute,
};
