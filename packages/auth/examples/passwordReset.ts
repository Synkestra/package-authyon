/**
 * Exemplo: fluxo de "esqueci minha senha", de ponta a ponta.
 *
 * 1. Usuário pede o reset informando o e-mail (tela pública, sem login).
 * 2. Authyon envia um e-mail com um link contendo um `token`.
 * 3. Usuário abre o link, define a nova senha — sua página lê o `token` da
 *    URL e chama `confirmPasswordReset`.
 */
import { AuthyonError, ErrorCodes, createClient } from "../src/index";

const authyon = createClient({ envKey: "pk_test_123" });

// ── 1. Tela "esqueci minha senha" ────────────────────────────────────────────

async function requestReset(email: string) {
  // Sempre resolve com sucesso (204), mesmo se o e-mail não existir — isso é
  // proposital, para não permitir enumerar contas cadastradas. Não trate a
  // resposta como confirmação de que o e-mail existe.
  await authyon.user.requestPasswordReset(email);
  console.log("Se esse e-mail existir, um link de redefinição foi enviado.");
}

// ── 2. Tela de redefinição (aberta a partir do link do e-mail) ──────────────

function getTokenFromUrl(): string {
  // No seu app real: new URLSearchParams(window.location.search).get("token")
  return "token-recebido-por-email";
}

async function confirmReset(newPassword: string) {
  const token = getTokenFromUrl();

  try {
    await authyon.user.confirmPasswordReset(token, newPassword);
    // Isso revoga TODOS os refresh tokens existentes do usuário — qualquer
    // sessão ativa em outros dispositivos é derrubada. Direcione o usuário
    // para a tela de login novamente.
    console.log("Senha redefinida. Faça login novamente.");
  } catch (err) {
    if (err instanceof AuthyonError) {
      if (err.is(ErrorCodes.PasswordWeak) || err.is(ErrorCodes.PasswordPwned)) {
        console.error("Escolha uma senha mais forte (ou que não tenha vazado antes).");
      } else if (err.status === 400 || err.status === 404) {
        console.error("Link de redefinição inválido ou expirado — peça um novo.");
      } else {
        console.error(`Erro (${err.code}):`, err.detail ?? err.message);
      }
    }
    throw err;
  }
}

export { requestReset, confirmReset };
