/** Backend completo: configuração server-only e proteção de uma rota Express. */
import { createClient, createExpressAuthorizationMiddleware } from "../src/index";

const authyon = createClient({
  envKey: process.env.AUTHYON_ENV_KEY,
  clientId: process.env.AUTHYON_CLIENT_ID,
  clientSecret: process.env.AUTHYON_CLIENT_SECRET,
});

export const requireReportsRead = createExpressAuthorizationMiddleware(authyon, {
  requirement: { action: "read", subject: "reports" },
});

/**
 * Uso real com Express:
 *
 * app.get("/api/reports", requireReportsRead, async (request, response) => {
 *   const reports = await repository.listForUser(request.authyon.userId);
 *   response.json(reports);
 * });
 */
export async function reportsHandler(
  request: { authyon?: { userId?: string } },
  response: { json(value: unknown): unknown },
) {
  const reports = [{ id: "report-1", ownerId: request.authyon?.userId }];
  response.json(reports);
}
