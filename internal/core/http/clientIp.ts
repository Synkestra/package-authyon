export interface ClientRequestContext {
  /** Real end-user IP, resolved only from infrastructure trusted by the application. */
  clientIp?: string;
}

export function clientIpHeaders(context?: ClientRequestContext): Record<string, string> {
  if (!context?.clientIp) return {};
  return { "X-Forwarded-For": normalizeClientIp(context.clientIp) };
}

/** Rejects header injection and values that are not a single IPv4 or IPv6 address. */
export function normalizeClientIp(value: string): string {
  let ip = value.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (
    !ip ||
    ip.length > 45 ||
    ip.includes(",") ||
    /[\r\n\s]/.test(ip) ||
    !/^[0-9a-f:.]+$/i.test(ip) ||
    (!ip.includes(".") && !ip.includes(":"))
  ) {
    throw invalidClientIp();
  }
  try {
    new URL(ip.includes(":") ? `http://[${ip}]` : `http://${ip}`);
  } catch {
    throw invalidClientIp();
  }
  return ip;
}

function invalidClientIp(): Error {
  return new Error("Authyon: `clientIp` must be a single valid IPv4 or IPv6 address");
}
