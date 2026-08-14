/**
 * Exemplo: separar páginas/rotas PÚBLICAS de PRIVADAS no frontend usando
 * @authyon/browser. Framework-agnostic — dá pra plugar isso num router
 * (React Router, Vue Router, etc.) ou num app vanilla com poucas adaptações.
 *
 * Público  = não exige sessão (home, login, register, pricing...).
 * Privada  = exige sessão válida (dashboard, configurações, dados do usuário...).
 *
 * Isso é DIFERENTE de "publishable key vs secret key" (pk_/sk_) — aquilo é
 * sobre QUAL API PODE chamar o quê (browser vs. seu backend). Isto aqui é
 * sobre QUAIS TELAS do seu app exigem um usuário logado. Os dois conceitos
 * convivem: mesmo uma rota "privada" no frontend continua usando a mesma
 * publishable key — ela só passa a exigir `getAccessToken()` != null antes
 * de renderizar.
 */
import { createClient } from "../src/index";

const authyon = createClient({ envKey: "pk_test_123" });

// ── Definindo as rotas ───────────────────────────────────────────────────────

type Route = { path: string; private: boolean; render: () => void };

const routes: Route[] = [
  { path: "/", private: false, render: renderHome },
  { path: "/login", private: false, render: renderLogin },
  { path: "/register", private: false, render: renderRegister },
  { path: "/pricing", private: false, render: renderPricing },

  { path: "/dashboard", private: true, render: renderDashboard },
  { path: "/settings", private: true, render: renderSettings },
  { path: "/settings/security", private: true, render: renderSecuritySettings },
];

function renderHome() {
  console.log("Home — visível para todos, logados ou não.");
}
function renderLogin() {
  console.log("Tela de login.");
}
function renderRegister() {
  console.log("Tela de cadastro.");
}
function renderPricing() {
  console.log("Planos — pública, mas pode mostrar CTA diferente se já logado.");
}
function renderDashboard() {
  console.log("Dashboard — só acessível autenticado.");
}
function renderSettings() {
  console.log("Configurações da conta.");
}
function renderSecuritySettings() {
  console.log("Segurança da conta (2FA, sessões) — ver examples/two-factor-setup.ts.");
}

// ── O "guard" que decide se pode renderizar a rota ──────────────────────────

async function navigate(path: string): Promise<void> {
  const route = routes.find((r) => r.path === path);
  if (!route) {
    console.log("404 — rota não encontrada.");
    return;
  }

  if (!route.private) {
    route.render();
    return;
  }

  // getAccessToken() renova o token sozinho se necessário; retorna null se
  // não houver sessão válida (ou se o refresh falhar por token revogado).
  const token = await authyon.getAccessToken();
  if (!token) {
    console.log(`Rota "${path}" exige login — redirecionando para /login.`);
    navigate("/login");
    return;
  }

  route.render();
}

// ── Reagindo a mudanças de sessão em tempo real ─────────────────────────────
// Ex.: se o token expirar/for revogado enquanto o usuário está numa página
// privada, tire-o de lá automaticamente.

let currentPath = "/";

authyon.onAuthStateChange((event) => {
  const route = routes.find((r) => r.path === currentPath);
  if (event.type === "signed_out" && route?.private) {
    console.log("Sessão encerrada enquanto em rota privada — redirecionando.");
    navigate("/login");
  }
});

function goTo(path: string) {
  currentPath = path;
  return navigate(path);
}

// ── Exemplo de uso ───────────────────────────────────────────────────────────

async function main() {
  await goTo("/"); // pública, renderiza direto
  await goTo("/dashboard"); // privada, sem sessão -> manda para /login

  await authyon.login({ email: "alice@acme.com", password: "..." });
  await goTo("/dashboard"); // agora renderiza normalmente
}

main().catch((err) => console.error("Falha no exemplo de rotas:", err));

export { navigate, goTo, routes };
