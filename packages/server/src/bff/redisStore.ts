import { EncryptJWT, jwtDecrypt } from "jose";
import { BffSessionError, type BffSessionRecord, type BffSessionStore } from "./contracts";

export interface BffRedisClient {
  get(key: string): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export interface RedisBffSessionStoreOptions {
  client: BffRedisClient;
  /** 32 random bytes kept outside Redis; changing this key invalidates existing sessions. */
  encryptionKey: Uint8Array;
  prefix?: string;
}

const COMPARE_AND_SWAP = `
local current = redis.call('GET', KEYS[1])
local revision = ''
if current then revision = cjson.decode(current).revision end
if revision ~= ARGV[1] then return 0 end
if ARGV[2] == '' then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
end
return 1
`;

/** node-redis-compatible adapter. Lua fences stale writers using the record revision. */
export function createRedisBffSessionStore(options: RedisBffSessionStoreOptions): BffSessionStore {
  if (options.encryptionKey.byteLength !== 32) {
    throw new Error("Authyon BFF: encryptionKey must contain 32 bytes");
  }
  const encryptionKey = new Uint8Array(options.encryptionKey);
  const prefix = options.prefix ?? "authyon:bff:";

  return {
    async read(key) {
      const serialized = await options.client.get(prefix + key);
      if (!serialized) return null;
      try {
        const envelope = JSON.parse(serialized) as { revision: string; ciphertext: string };
        const { payload } = await jwtDecrypt(envelope.ciphertext, encryptionKey, {
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
          audience: prefix + key,
        });
        const record = payload.session as BffSessionRecord;
        if (!record || record.revision !== envelope.revision) throw new Error("revision mismatch");
        return record;
      } catch {
        throw new BffSessionError("session.storage_invalid", 503);
      }
    },
    async compareAndSwap(key, expectedRevision, next) {
      const expiresAt = next ? Math.min(next.expiresAt, next.idleExpiresAt) : Date.now();
      const ttl = Math.ceil(expiresAt - Date.now());
      if (next && ttl <= 0) return false;
      let serialized = "";
      if (next) {
        const ciphertext = await new EncryptJWT({ session: next })
          .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
          .setAudience(prefix + key)
          .encrypt(encryptionKey);
        serialized = JSON.stringify({ revision: next.revision, ciphertext });
      }
      const result = await options.client.eval(COMPARE_AND_SWAP, {
        keys: [prefix + key],
        arguments: [expectedRevision ?? "", serialized, String(ttl)],
      });
      return result === 1;
    },
  };
}
