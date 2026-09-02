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
import type { Session, User } from "../contracts/auth";
import {
  AuthyonSessionController,
  type SessionControllerOptions,
  type SessionSnapshot,
} from "../session/sessionController";

export interface AuthyonProviderProps<TUser extends User = User> extends SessionControllerOptions {
  client: AuthyonClient;
  children: ReactNode;
  /** Revalidate with `/auth/me` when the tab becomes visible. Defaults to true. */
  validateOnFocus?: boolean;
  /** Derives the user exposed by `useAuthyon` without mutating the stored Authyon session. */
  transformUser?: (user: User) => TUser;
}

export type AuthyonSession<TUser extends User = User> = Omit<Session, "user"> & {
  user?: TUser;
};

export type AuthyonSessionSnapshot<TUser extends User = User> = Omit<
  SessionSnapshot,
  "session" | "user"
> & {
  session: AuthyonSession<TUser> | null;
  user: TUser | null;
};

export interface AuthyonReactContextValue<
  TUser extends User = User,
> extends AuthyonSessionSnapshot<TUser> {
  client: AuthyonClient;
  validateSession(): Promise<AuthyonSessionSnapshot<TUser>>;
  refreshSession(): Promise<AuthyonSessionSnapshot<TUser>>;
}

const AuthyonReactContext = createContext<AuthyonReactContextValue | null>(null);

export function AuthyonProvider<TUser extends User = User>({
  client,
  children,
  refreshAheadMs,
  validateOnFocus = true,
  transformUser,
}: AuthyonProviderProps<TUser>) {
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

  const exposedSnapshot = useMemo(
    () => transformSnapshot(snapshot, transformUser),
    [snapshot, transformUser],
  );
  const value = useMemo<AuthyonReactContextValue<TUser>>(
    () => ({
      ...exposedSnapshot,
      client,
      validateSession: async () => transformSnapshot(await controller.validate(), transformUser),
      refreshSession: async () => transformSnapshot(await controller.refreshNow(), transformUser),
    }),
    [client, controller, exposedSnapshot, transformUser],
  );
  return createElement(AuthyonReactContext.Provider, { value }, children);
}

export function useAuthyon<TUser extends User = User>(): AuthyonReactContextValue<TUser> {
  const context = useContext(AuthyonReactContext);
  if (!context) throw new Error("Authyon: `useAuthyon` must be used inside `AuthyonProvider`");
  return context as AuthyonReactContextValue<TUser>;
}

function transformSnapshot<TUser extends User>(
  snapshot: SessionSnapshot,
  transformUser?: (user: User) => TUser,
): AuthyonSessionSnapshot<TUser> {
  const mapUser = (user: User): TUser => (transformUser ? transformUser(user) : (user as TUser));
  const user = snapshot.user ? mapUser(snapshot.user) : null;
  const session = snapshot.session
    ? {
        ...snapshot.session,
        user: snapshot.session.user
          ? snapshot.session.user === snapshot.user && user
            ? user
            : mapUser(snapshot.session.user)
          : undefined,
      }
    : null;

  return { ...snapshot, session, user };
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
