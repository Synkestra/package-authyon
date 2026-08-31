# Configuração de 2FA

Código: [`packages/auth/examples/twoFactorSetup.ts`](../../packages/auth/examples/twoFactorSetup.ts).

O fluxo cria o segredo, confirma o primeiro código e apresenta recovery codes apenas uma vez. Não registre segredo, códigos TOTP ou recovery codes em logs e não os persista em `localStorage`.
