import assert from "node:assert/strict";
import test from "node:test";

import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  JwksTokenVerifier,
  TokenVerificationError,
  authorizeToken,
} from "../packages/server/dist/index.js";

const issuer = "https://issuer.authyon.test";
const audience = "reports-api";

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "key-1";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const verifier = new JwksTokenVerifier({
    issuer,
    audience,
    jwks: { keys: [publicJwk] },
  });
  return { privateKey, verifier };
}

async function token(privateKey, overrides = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    permissions: ["reports:read"],
    roles: ["analyst"],
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "at+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user-1")
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

test("verifies Authyon access-token signatures and required claims", async () => {
  const { privateKey, verifier } = await fixture();
  const verified = await verifier.verifyAccessToken(await token(privateKey));
  assert.equal(verified.claims.sub, "user-1");
  assert.deepEqual(verified.claims.permissions, ["reports:read"]);
  assert.equal(verified.protectedHeader.alg, "RS256");
});

test("rejects wrong audience, expiration, type and algorithm configuration", async () => {
  const { privateKey, verifier } = await fixture();
  const wrongAudience = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "at+jwt" })
    .setIssuer(issuer)
    .setAudience("another-api")
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  await assert.rejects(
    verifier.verifyAccessToken(wrongAudience),
    (error) => error instanceof TokenVerificationError && error.code === "token.invalid_claims",
  );

  const expired = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "at+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user-1")
    .setIssuedAt(Math.floor(Date.now() / 1_000) - 120)
    .setExpirationTime(Math.floor(Date.now() / 1_000) - 60)
    .sign(privateKey);
  await assert.rejects(
    verifier.verifyAccessToken(expired),
    (error) => error instanceof TokenVerificationError && error.code === "token.expired",
  );

  const wrongType = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "refresh+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  await assert.rejects(
    verifier.verifyAccessToken(wrongType),
    (error) => error instanceof TokenVerificationError && error.code === "token.invalid_claims",
  );

  assert.throws(
    () =>
      new JwksTokenVerifier({
        issuer,
        audience,
        jwks: { keys: [] },
        algorithms: ["HS256"],
      }),
    /asymmetric/,
  );
});

test("uses verified JWKS claims in framework authorization", async () => {
  const { privateKey, verifier } = await fixture();
  const context = await authorizeToken({}, await token(privateKey), {
    verification: "jwks",
    jwksVerifier: verifier,
    requirement: { action: "read", subject: "reports" },
  });
  assert.equal(context.userId, "user-1");
  assert.equal(context.ability.can("read", "reports"), true);
});

test("rejects untrusted JWKS locations and oversized credentials", async () => {
  assert.throws(
    () =>
      new JwksTokenVerifier({
        issuer,
        audience,
        jwksUri: "http://issuer.authyon.test/jwks",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      new JwksTokenVerifier({
        issuer,
        audience,
        jwksUri: "https://attacker.example/jwks",
      }),
    /same trusted origin/,
  );
  const { verifier } = await fixture();
  await assert.rejects(
    verifier.verifyAccessToken("x".repeat(16_385)),
    (error) => error instanceof TokenVerificationError && error.code === "token.invalid",
  );
});
