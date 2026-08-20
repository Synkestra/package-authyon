/**
 * Exemplo: habilitar, confirmar e gerenciar 2FA via app autenticador.
 *
 * Fluxo: usuário já logado → gera secret/QR → usuário escaneia no app
 * (Google Authenticator, Authy, etc.) → confirma com um código → recebe
 * recovery codes para guardar em local seguro.
 */
import { AuthyonError, createClient } from "../src/index";

const authyon = createClient({ envKey: "pk_test_123" });

// ── 1. Status atual do 2FA ──────────────────────────────────────────────────

async function checkStatus() {
  const status = await authyon.twoFactor.status();
  console.log("Métodos habilitados:", status.methods);
  console.log("Recovery codes restantes:", status.recoveryCodesRemaining ?? 0);
  return status;
}

// ── 2. Habilitar app autenticador ────────────────────────────────────────────

async function enrollAuthenticator() {
  const setup = await authyon.twoFactor.setupAuthenticator();

  // Mostre o QR code (setup.qrSvg é um SVG pronto) ou o otpauthUri/secret
  // para quem preferir digitar manualmente.
  console.log("Escaneie este QR no seu app autenticador:");
  console.log(setup.qrSvg);
  console.log("Ou use o secret manualmente:", setup.secret);
  console.log("otpauth URI:", setup.otpauthUri);

  return setup;
}

// ── 3. Confirmar com o primeiro código gerado pelo app ──────────────────────

async function confirmAuthenticator(codeFromApp: string) {
  try {
    const { recoveryCodes } = await authyon.twoFactor.confirmAuthenticator(codeFromApp);

    // Estes 10 códigos só aparecem UMA vez — oriente o usuário a salvá-los
    // (gerenciador de senhas, PDF impresso, etc.) antes de fechar a tela.
    console.log("2FA habilitado! Guarde estes recovery codes em local seguro:");
    recoveryCodes.forEach((code, i) => console.log(`${i + 1}. ${code}`));

    return recoveryCodes;
  } catch (err) {
    if (err instanceof AuthyonError) {
      console.error("Código inválido ou expirado:", err.detail ?? err.message);
    }
    throw err;
  }
}

// ── 4. Regenerar recovery codes (requer a senha atual) ──────────────────────

async function regenerateRecoveryCodes(currentPassword: string) {
  try {
    const { recoveryCodes } = await authyon.twoFactor.regenerateRecoveryCodes(currentPassword);
    console.log("Novos recovery codes (os antigos foram invalidados):", recoveryCodes);
    return recoveryCodes;
  } catch (err) {
    if (err instanceof AuthyonError && err.status === 401) {
      console.error("Senha incorreta — peça para o usuário confirmá-la de novo.");
    }
    throw err;
  }
}

// ── 5. Completar um login que exigiu 2FA ────────────────────────────────────
// (fluxo completo de login está em auth-flow.ts — aqui é só o passo de 2FA)

async function completeLoginWithRecoveryCode(challengeToken: string, recoveryCode: string) {
  // Alternativa ao código do app: usar um recovery code de uso único quando
  // o usuário perdeu acesso ao autenticador (aceito no mesmo campo `code`).
  const session = await authyon.verifyTwoFactor({
    challengeToken,
    method: "authenticator",
    code: recoveryCode,
  });
  console.log("Login concluído via recovery code para", session.user?.email);
  return session;
}

// ── Rodando o fluxo completo de habilitação ─────────────────────────────────

async function main() {
  await checkStatus();
  await enrollAuthenticator();

  // Em um app real, o código abaixo viria de um input do usuário.
  const codeFromApp = "123456";
  await confirmAuthenticator(codeFromApp);
}

main().catch((err) => {
  console.error("Falha no fluxo de 2FA:", err);
});

export {
  checkStatus,
  enrollAuthenticator,
  confirmAuthenticator,
  regenerateRecoveryCodes,
  completeLoginWithRecoveryCode,
};
