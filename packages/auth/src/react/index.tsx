"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createAuthyonAbility,
  type AbilitySubject,
  type AuthyonAbility,
  type AuthyonAbilityOptions,
} from "../../../../internal/core/authorization/ability";
import type { AuthyonClient } from "../client/authyonClient";
import {
  AuthyonSessionController,
  type SessionControllerOptions,
  type SessionSnapshot,
} from "../session/sessionController";

export interface AuthyonProviderProps extends SessionControllerOptions {
  client: AuthyonClient;
  children: ReactNode;
  /** Revalidate with `/auth/me` when the tab becomes visible. Defaults to true. */
  validateOnFocus?: boolean;
}

interface AuthyonReactContextValue extends SessionSnapshot {
  client: AuthyonClient;
  validateSession(): Promise<SessionSnapshot>;
  refreshSession(): Promise<SessionSnapshot>;
}

const AuthyonReactContext = createContext<AuthyonReactContextValue | null>(null);

export function AuthyonProvider({
  client,
  children,
  refreshAheadMs,
  validateOnFocus = true,
}: AuthyonProviderProps) {
  const controllerRef = useRef<AuthyonSessionController | null>(null);
  if (!controllerRef.current || controllerRef.current.client !== client) {
    controllerRef.current = new AuthyonSessionController(client, { refreshAheadMs });
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );

  useEffect(() => controller.start(), [controller]);
  useEffect(() => {
    if (!validateOnFocus) return;
    const validateWhenVisible = () => {
      if (document.visibilityState === "visible") void controller.validate();
    };
    document.addEventListener("visibilitychange", validateWhenVisible);
    return () => document.removeEventListener("visibilitychange", validateWhenVisible);
  }, [controller, validateOnFocus]);

  const value = useMemo<AuthyonReactContextValue>(
    () => ({
      ...snapshot,
      client,
      validateSession: () => controller.validate(),
      refreshSession: () => controller.refreshNow(),
    }),
    [client, controller, snapshot],
  );
  return createElement(AuthyonReactContext.Provider, { value }, children);
}

export function useAuthyon(): AuthyonReactContextValue {
  const context = useContext(AuthyonReactContext);
  if (!context) throw new Error("Authyon: `useAuthyon` must be used inside `AuthyonProvider`");
  return context;
}

export function useAuthyonAbility(options: AuthyonAbilityOptions = {}): AuthyonAbility {
  const { user } = useAuthyon();
  return useMemo(() => createAuthyonAbility(user ?? {}, options), [user, options]);
}

export function useCan(
  action: string,
  subject: AbilitySubject,
  field?: string,
  options?: AuthyonAbilityOptions,
): boolean {
  const ability = useAuthyonAbility(options);
  return ability.can(action, subject, field);
}

export interface SessionGuardProps {
  children: ReactNode;
  loadingFallback?: ReactNode;
  unauthenticatedFallback?: ReactNode;
  errorFallback?: ReactNode;
  onUnauthenticated?: () => void;
}

export function SessionGuard({
  children,
  loadingFallback = null,
  unauthenticatedFallback = null,
  errorFallback = null,
  onUnauthenticated,
}: SessionGuardProps) {
  const { status } = useAuthyon();
  useEffect(() => {
    if (status === "unauthenticated") onUnauthenticated?.();
  }, [onUnauthenticated, status]);
  if (status === "validating") return loadingFallback;
  if (status === "error") return errorFallback;
  if (status !== "authenticated") return unauthenticatedFallback;
  return children;
}

export interface PermissionGuardProps extends SessionGuardProps {
  action: string;
  subject: AbilitySubject;
  field?: string;
  forbiddenFallback?: ReactNode;
  abilityOptions?: AuthyonAbilityOptions;
}

export function PermissionGuard({
  action,
  subject,
  field,
  forbiddenFallback = null,
  abilityOptions,
  children,
  ...sessionProps
}: PermissionGuardProps) {
  const allowed = useCan(action, subject, field, abilityOptions);
  return createElement(SessionGuard, {
    ...sessionProps,
    children: allowed ? children : forbiddenFallback,
  });
}

export { AuthyonSessionController } from "../session/sessionController";
export type {
  SessionControllerOptions,
  SessionSnapshot,
  SessionSnapshotListener,
  SessionStatus,
} from "../session/sessionController";
