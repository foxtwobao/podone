import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, type UserInfo } from './api';
import { isValidRedirectTarget } from './format';

const REDIRECT_KEY = 'podone_login_redirect';

export function saveLoginRedirect(target?: string | null) {
  if (isValidRedirectTarget(target)) {
    sessionStorage.setItem(REDIRECT_KEY, target);
  } else {
    sessionStorage.removeItem(REDIRECT_KEY);
  }
}

export function consumeLoginRedirect(): string {
  const target = sessionStorage.getItem(REDIRECT_KEY);
  sessionStorage.removeItem(REDIRECT_KEY);
  return isValidRedirectTarget(target) ? target : '/';
}

interface AuthContextValue {
  user: UserInfo | null;
  loading: boolean;
  isAdmin: boolean;
  refreshUser: () => Promise<UserInfo | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isAdmin: false,
  refreshUser: async () => null,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const info = await api.getUserInfo();
      setUser(info);
      return info;
    } catch {
      setToken(null);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try {
      if (getToken()) {
        await api.logout();
      }
    } catch {
      // Clear local session even if token was already expired.
    } finally {
      setToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: user?.superAdmin === 1,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
