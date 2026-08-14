/**
 * Exemplo ILUSTRATIVO de gestão de organização/membros — roda no SEU BACKEND,
 * nunca no browser.
 *
 * Por quê no backend: adicionar um usuário a uma organização e atribuir
 * scopes/roles são operações de "server-to-server management API", que
 * exigem a SECRET KEY (`sk_...`). A publishable key (`pk_...`) usada pelo
 * @authyon/browser só acessa os endpoints públicos de auth (login, 2FA,
 * refresh, etc.) — ela nunca deve conseguir conceder acesso a uma organização
 * sozinha, senão qualquer pessoa no navegador poderia se auto-promover.
 *
 * ATENÇÃO: os paths/bodies abaixo seguem o padrão REST que a doc pública do
 * Authyon descreve para o restante da API (ex.: POST /auth/switch-tenant
 * usa `tenantSlug`), mas não consegui abrir a página de "API reference" da
 * management API para confirmar nomes exatos de endpoint e campos no momento
 * em que este arquivo foi escrito. Confirme no dashboard/API reference do
 * Authyon antes de usar em produção — ajuste os paths conforme necessário.
 */

const AUTHYON_API = "https://api.authyon.com";
// sk_live_... — carregue de uma variável de ambiente do servidor; nunca exponha isso no frontend
declare const SECRET_KEY: string;

async function authyonManagementRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${AUTHYON_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Authyon management API error (${res.status}): ${body.code ?? body.title ?? "unknown"}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── 1. Criar a organização (tenant) ─────────────────────────────────────────

interface CreateOrganizationInput {
  name: string;
  slug: string;
  /** Usuário que vira o dono/admin inicial da organização. */
  ownerUserId: string;
}

async function createOrganization(input: CreateOrganizationInput) {
  return authyonManagementRequest<{ id: string; slug: string }>("/tenants", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
    }),
  }).then(async (org) => {
    // adiciona o criador como membro/owner
    await addMember(org.slug, input.ownerUserId, { role: "owner" });
    return org;
  });
}

// ── 2. Adicionar um usuário existente a uma organização ─────────────────────

interface AddMemberInput {
  /** Role/scope do membro dentro da organização — ex.: "owner", "admin", "member". */
  role: string;
  /** Scopes/permissões finas, se o Authyon suportar granularidade além do role. */
  scopes?: string[];
}

async function addMember(organizationSlug: string, userId: string, input: AddMemberInput) {
  return authyonManagementRequest<{ userId: string; role: string; scopes?: string[] }>(
    `/tenants/${organizationSlug}/members`,
    {
      method: "POST",
      body: JSON.stringify({
        userId,
        role: input.role,
        scopes: input.scopes,
      }),
    },
  );
}

// ── 3. Convidar por e-mail (usuário ainda não existe / ainda não é membro) ──

interface InviteInput {
  email: string;
  role: string;
  scopes?: string[];
}

async function inviteToOrganization(organizationSlug: string, input: InviteInput) {
  // Fluxo comum: cria um convite que o usuário aceita depois de logado.
  return authyonManagementRequest<{ inviteId: string }>(`/tenants/${organizationSlug}/invites`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── 4. Ajustar scopes/role de um membro já existente ────────────────────────

async function updateMemberScopes(organizationSlug: string, userId: string, scopes: string[]) {
  return authyonManagementRequest<void>(`/tenants/${organizationSlug}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ scopes }),
  });
}

// ── 5. Remover acesso ────────────────────────────────────────────────────────

async function removeMember(organizationSlug: string, userId: string) {
  return authyonManagementRequest<void>(`/tenants/${organizationSlug}/members/${userId}`, {
    method: "DELETE",
  });
}

// ── Exemplo de rota de backend (Express-like) que o frontend chama ─────────

async function handleCreateOrganizationRoute(req: {
  userId: string;
  body: { name: string; slug: string };
}) {
  // req.userId viria de você ter validado o JWT do Authyon nesta requisição
  // (ex.: POST /auth/validate ou verificação local via JWKS).
  const org = await createOrganization({
    name: req.body.name,
    slug: req.body.slug,
    ownerUserId: req.userId,
  });
  return { slug: org.slug };
}

async function handleInviteRoute(req: { organizationSlug: string; body: InviteInput }) {
  return inviteToOrganization(req.organizationSlug, req.body);
}

export {
  createOrganization,
  addMember,
  inviteToOrganization,
  updateMemberScopes,
  removeMember,
  handleCreateOrganizationRoute,
  handleInviteRoute,
};
