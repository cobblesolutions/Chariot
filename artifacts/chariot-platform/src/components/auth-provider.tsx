import { createContext, useContext, ReactNode } from "react";
import {
  useGetCurrentUser,
  AuthUser,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "./ui/skeleton";
import { queryClient } from "@/lib/queryClient";

type AuthContextType = {
  user: AuthUser | null | undefined;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: undefined,
  isLoading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    data: user,
    isLoading,
    error,
  } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      retry: false,
    },
  });

  const resolvedUser = error ? null : user;
  const isActuallyLoading = isLoading;

  return (
    <AuthContext.Provider
      value={{ user: resolvedUser, isLoading: isActuallyLoading }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
    );
  }

  if (!user) {
    // We cannot use <Redirect> here safely without rendering loop if not handled well,
    // but a <Redirect to="/login" /> component works with wouter.
    // Wait, better to just render it directly.
    return null; // The routing logic handles the redirect.
  }

  return <>{children}</>;
}
