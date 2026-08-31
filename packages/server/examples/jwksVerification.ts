/** Local JWT verification with automatic Authyon OpenID/JWKS discovery. */
import {
  createClient,
  createExpressAuthorizationMiddleware,
  TokenVerificationError,
} from "../src/index";

const authyon = createClient({ envKey: process.env.AUTHYON_ENV_KEY });

// Create once at startup so JWKS keys and rotations are cached.
const verifier = await authyon.createJwksTokenVerifier({
  audience: process.env.AUTHYON_AUDIENCE!,
  algorithms: ["RS256"],
});

export const requireValidToken = createExpressAuthorizationMiddleware(authyon, {
  verification: "jwks",
  jwksVerifier: verifier,
});

export async function verifyDirectly(token: string) {
  try {
    const { claims } = await verifier.verifyAccessToken(token);
    return { userId: claims.sub, permissions: claims.permissions ?? [] };
  } catch (error) {
    if (error instanceof TokenVerificationError) {
      console.warn("Credential rejected", { code: error.code });
    }
    throw error;
  }
}
