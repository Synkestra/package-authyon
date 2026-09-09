import type { ReactNode } from "react";
import type { AbilitySubject } from "../../../internal/core/authorization/ability";
import type { AuthyonServerClient } from "./client/authyonServerClient";
import {
  AuthorizationError,
  authorizeRequest,
  authorizeToken,
  type AuthorizationContext,
  type AuthorizationOptions,
  type RequestAuthorizationOptions,
} from "./integrations/authorization";

export interface ServerPermissionGuardFallbackContext {
  error: AuthorizationError;
}

export type ServerPermissionGuardFallback =
  ReactNode | ((context: ServerPermissionGuardFallbackContext) => ReactNode | Promise<ReactNode>);

export interface ServerPermissionGuardProps extends Omit<
  RequestAuthorizationOptions,
  "requirement"
> {
  client: AuthyonServerClient;
  action: string;
  subject: AbilitySubject;
  field?: string;
  children: ReactNode;
  /** Bearer token already extracted from cookies, headers or session state. */
  token?: string | null;
  /** Web Request available in Route Handlers and other Fetch runtimes. */
  request?: Pick<Request, "headers">;
  unauthenticatedFallback?: ServerPermissionGuardFallback;
  forbiddenFallback?: ServerPermissionGuardFallback;
  unavailableFallback?: ServerPermissionGuardFallback;
}

/** Server Component guard for Next.js layouts and pages. */
export async function PermissionGuard({
  client,
  action,
  subject,
  field,
  children,
  token,
  request,
  unauthenticatedFallback = null,
  forbiddenFallback = null,
  unavailableFallback,
  ...options
}: ServerPermissionGuardProps): Promise<ReactNode> {
  try {
    await authorizeGuardRequest(client, {
      ...options,
      request,
      token,
      requirement: { action, subject, field },
    });
    return children;
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (error.status === 401) return renderFallback(unauthenticatedFallback, error);
    if (error.status === 403) return renderFallback(forbiddenFallback, error);
    if (unavailableFallback !== undefined) return renderFallback(unavailableFallback, error);
    throw error;
  }
}

interface GuardAuthorizationOptions extends AuthorizationOptions {
  request?: Pick<Request, "headers">;
  token?: string | null;
  resolveClientIp?: (request: Pick<Request, "headers">) => string | undefined;
}

function authorizeGuardRequest(
  client: AuthyonServerClient,
  options: GuardAuthorizationOptions,
): Promise<AuthorizationContext> {
  const { request, token, ...authorizationOptions } = options;
  if (request) return authorizeRequest(client, request, authorizationOptions);
  return authorizeToken(client, token ?? "", authorizationOptions);
}

function renderFallback(
  fallback: ServerPermissionGuardFallback,
  error: AuthorizationError,
): ReactNode | Promise<ReactNode> {
  return typeof fallback === "function" ? fallback({ error }) : fallback;
}
