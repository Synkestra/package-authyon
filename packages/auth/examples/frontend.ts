/** Frontend completo: login, autorização visual e consumo do backend protegido. */
import { AuthyonError, createAuthyonAbility, createClient } from "../src/index";

const authyon = createClient({
  envKey: "pk_test_123",
});

export async function signIn(email: string, password: string) {
  const result = await authyon.login({ email, password });
  if (result.twoFactorRequired) {
    return { requiresTwoFactor: true, challenge: result };
  }
  return { requiresTwoFactor: false, user: result.session.user };
}

export function canShowReports() {
  const user = authyon.getSession()?.user;
  return user ? createAuthyonAbility(user).can("read", "reports") : false;
}

export async function loadReports() {
  const accessToken = await authyon.getAccessToken();
  if (!accessToken) throw new Error("Usuário não autenticado");

  const response = await fetch("/api/reports", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) throw new Error("Sessão inválida ou expirada");
  if (response.status === 403) throw new Error("Sem permissão para consultar relatórios");
  if (!response.ok) throw new Error("Não foi possível carregar os relatórios");
  return response.json();
}

export function userMessage(error: unknown): string {
  if (!(error instanceof AuthyonError)) return "Ocorreu um erro inesperado";
  return error.interpret().message;
}
