/**
 * Exemplo end-to-end de autenticação com @authyon/auth.
 *
 * Cobre: registro, login (com e sem 2FA), sessão/refresh automático,
 * organizações, logout e tratamento de erros. Não é executado automaticamente
 * — é um guia de referência para copiar/colar no seu app.
 */
import { AuthyonError, createClient, ErrorCodes, type LoginResult } from "../src/index";

const authyon = createClient({
  envKey: "pk_test_123", // troque pela sua publishable key
});

// ── 1. Registro ────────────────────────────────────────────────────────────

async function registerUser() {
  try {
    const { id } = await authyon.register({
      email: "alice@acme.com",
      username: "alice",
      password: "uma-senha-bem-forte",
    });
    console.log("Usuário criado:", id);
  } catch (err) {
    if (err instanceof AuthyonError) {
      switch (err.code) {
        case ErrorCodes.EmailTaken:
          console.error("Esse e-mail já está cadastrado.");
          break;
        case ErrorCodes.PasswordWeak:
        case ErrorCodes.PasswordPwned:
          console.error("Escolha uma senha mais forte.");
          break;
        default:
          console.error(`Erro (${err.code}):`, err.detail ?? err.message);
      }
    }
    throw err;
  }
}

// ── 2. Login, com suporte a 2FA ─────────────────────────────────────────────

async function login() {
  const result: LoginResult = await authyon.login({
    email: "alice@acme.com",
    password: "uma-senha-bem-forte",
    organizationSlug: "acme", // opcional — escopa a sessão numa organização
  });

  if (result.twoFactorRequired) {
    // Peça o código ao usuário (app autenticador, e-mail, ou recovery code).
    const code = await promptForCode(result.methods, result.emailHint);
    const session = await authyon.completeTwoFactorChallenge({
      challengeId: result.challengeId,
      method: result.methods[0],
      code,
    });
    console.log("Login (com 2FA) concluído para", session.user?.email);
    return session;
  }

  console.log("Login concluído para", result.session.user?.email);
  return result.session;
}

async function promptForCode(methods: string[], emailHint?: string): Promise<string> {
  // Em um app real isso seria um formulário. Aqui é só ilustrativo.
  console.log(
    `Digite o código 2FA (${methods.join(", ")})`,
    emailHint ? `enviado para ${emailHint}` : "",
  );
  return "000000";
}

// ── 3. Sessão atual, refresh automático e eventos ───────────────────────────

function watchAuthState() {
  return authyon.onAuthStateChange((event) => {
    switch (event.type) {
      case "signed_in":
        console.log("Sessão iniciada:", event.session.user?.email);
        break;
      case "refreshed":
        console.log("Token renovado, expira em", new Date(event.session.expiresAt));
        break;
      case "signed_out":
        console.log("Sessão encerrada.");
        break;
    }
  });
}

async function fetchProfile() {
  // getAccessToken() renova o token sozinho se estiver perto de expirar.
  if (!(await authyon.getAccessToken())) {
    console.log("Usuário não autenticado.");
    return;
  }
  const user = await authyon.user.me();
  console.log("Perfil atual:", user);
}

// ── 4. Organizações ──────────────────────────────────────────────────────────

async function switchToOrganization(slug: string) {
  const orgs = await authyon.organization.list();
  console.log(
    "Organizações do usuário:",
    orgs.map((o) => o.slug),
  );

  if (orgs.some((o) => o.slug === slug)) {
    await authyon.organization.switch(slug);
    console.log("Sessão agora escopada em", authyon.organization.current()?.slug);
  }
}

// ── 5. Sessões e invalidação de token ───────────────────────────────────────

async function reviewSessions() {
  // Lista todas as sessões (refresh tokens) ativas do usuário, com device/IP.
  const sessions = await authyon.user.sessions();
  console.log("Sessões ativas:", sessions);

  // Invalida (revoga) uma sessão específica sem derrubar a atual — ex.: um
  // botão "sair deste dispositivo" numa tela de segurança da conta.
  const other = sessions.find((s) => !s.current);
  if (other) {
    await authyon.user.revokeSession(other.id);
    console.log("Sessão revogada:", other.id);
  }
}

// ── 6. Logout ────────────────────────────────────────────────────────────────

async function logout(everywhere = false) {
  await authyon.logout({ everywhere });
  console.log(everywhere ? "Deslogado de todos os dispositivos." : "Deslogado.");
}

// ── Rodando o fluxo completo ─────────────────────────────────────────────────

async function main() {
  const unsubscribe = watchAuthState();

  await registerUser().catch(() => {
    // segue o fluxo mesmo se o usuário já existir
  });

  await login();
  await fetchProfile();
  await switchToOrganization("acme");
  await reviewSessions();
  await logout();

  unsubscribe();
}

main().catch((err) => {
  console.error("Falha no fluxo de exemplo:", err);
});
