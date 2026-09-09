"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient, createMemoryStorage } from "../src/index";
import { AuthyonProvider, PermissionGuard, SessionGuard, useAuthyon } from "../src/react/index";

const authyon = createClient({
  envKey: process.env.NEXT_PUBLIC_AUTHYON_ENV_KEY!,
  storage: createMemoryStorage(),
  autoRefresh: true,
});

export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthyonProvider client={authyon} validateOnFocus refreshAheadMs={30_000}>
      {children}
    </AuthyonProvider>
  );
}

export function ProtectedReports() {
  const router = useRouter();
  const redirectToLogin = useCallback(() => router.replace("/login"), [router]);

  return (
    <SessionGuard
      loadingFallback={<p>Validando sessão...</p>}
      errorFallback={<SessionError />}
      onUnauthenticated={redirectToLogin}
    >
      <PermissionGuard
        action="read"
        subject="reports"
        forbiddenFallback={<p>Você não possui acesso aos relatórios.</p>}
      >
        <Reports />
      </PermissionGuard>
    </SessionGuard>
  );
}

function SessionError() {
  const { validateSession } = useAuthyon();
  return <button onClick={() => void validateSession()}>Tentar novamente</button>;
}

function Reports() {
  const { user } = useAuthyon();
  return <p>Relatórios liberados para {user?.email}</p>;
}
