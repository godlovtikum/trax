/**
 * AuthContext — single source of truth for the signed-in user, their
 * profile, and the auth lifecycle (sign in / sign up / sign out).
 *
 * All errors thrown here carry user-facing messages, so screens can
 * surface them directly without further translation.
 */

import React, {createContext, useContext, useEffect, useState, useCallback} from 'react';
import {
  apiFetch,
  ApiError,
  clearSession,
  getSession,
  isApiConfigured,
  loadStoredSession,
  onAuthChange,
  setSession,
  type AuthSession,
} from '../lib/api';
import type {Profile} from '../types';

type SignedInUser = AuthSession['user'];

interface AuthContextValue {
  session: AuthSession | null;
  user: SignedInUser | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [currentSession, setCurrentSession] = useState<AuthSession | null>(null);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [isInitialising, setIsInitialising] = useState(true);

  const loadProfileForCurrentUser = useCallback(async () => {
    try {
      const profileResponse = await apiFetch<Profile | null>('/api/profile');
      setCurrentProfile(profileResponse);
    } catch (profileError) {
      // Profile fetch failure is non-fatal — the user can still use the app.
      // Common cases: offline on first launch, or transient network blip.
      if (!(profileError instanceof ApiError && profileError.isOfflineError)) {
        console.warn('[auth] profile fetch failed:', profileError);
      }
      setCurrentProfile(null);
    }
  }, []);

  // Boot: hydrate the session from secure storage, optionally validate it,
  // then start listening for changes.
  useEffect(() => {
    if (!isApiConfigured) {
      setIsInitialising(false);
      return;
    }
    (async () => {
      const storedSession = await loadStoredSession();
      setCurrentSession(storedSession);
      if (storedSession) {
        await loadProfileForCurrentUser();
      }
      setIsInitialising(false);
    })();
    return onAuthChange(updatedSession => {
      setCurrentSession(updatedSession);
      if (updatedSession) {
        loadProfileForCurrentUser();
      } else {
        setCurrentProfile(null);
      }
    });
  }, [loadProfileForCurrentUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isApiConfigured) {
      throw new ApiError(
        'system.unknown_error',
        'The app is not fully configured. Please reinstall and try again.',
        500,
      );
    }
    const sessionResponse = await apiFetch<AuthSession>('/api/auth/login', {
      method: 'POST',
      auth: false,
      offlineable: false,
      body: {email, password},
    });
    await setSession(sessionResponse);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, fullName?: string) => {
      if (!isApiConfigured) {
        throw new ApiError(
          'system.unknown_error',
          'The app is not fully configured. Please reinstall and try again.',
          500,
        );
      }
      const sessionResponse = await apiFetch<AuthSession>('/api/auth/signup', {
        method: 'POST',
        auth: false,
        offlineable: false,
        body: {email, password, full_name: fullName},
      });
      await setSession(sessionResponse);
    },
    [],
  );

  const signOut = useCallback(async () => {
    const existingSession = getSession();
    if (existingSession) {
      try {
        await apiFetch('/api/auth/logout', {method: 'POST', offlineable: false});
      } catch (logoutError) {
        // Server-side logout is best-effort. We always clear locally so the
        // user isn't trapped in a broken state.
        console.warn('[auth] server logout failed:', logoutError);
      }
    }
    await clearSession();
    setCurrentProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (currentSession) await loadProfileForCurrentUser();
  }, [currentSession, loadProfileForCurrentUser]);

  return (
    <AuthContext.Provider
      value={{
        session: currentSession,
        user: currentSession?.user ?? null,
        profile: currentProfile,
        loading: isInitialising,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
