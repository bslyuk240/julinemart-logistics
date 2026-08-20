import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api, RiderStatus } from '../lib/api';

// 'no_application' and 'error' are client-only states — the backend only
// ever reports the four RiderStatus values that exist as a riders.status.
export type ApplicationState = RiderStatus | 'no_application' | 'error';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  riderId: string | null;
  riderStatus: ApplicationState | null;
  riderRejectReason: string | null;
  riderCreatedAt: string | null;
  riderActive: boolean | null;
  loading: boolean;
  refreshRiderStatus: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [riderId, setRiderId] = useState<string | null>(null);
  const [riderStatus, setRiderStatus] = useState<ApplicationState | null>(null);
  const [riderRejectReason, setRiderRejectReason] = useState<string | null>(null);
  const [riderCreatedAt, setRiderCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // rider-ping doubles as "what does this login's riders row look like right
  // now" — status, reject reason, and the rider's own id (distinct from the
  // auth user id, needed for endpoints keyed on riders.id).
  const checkRiderStatus = async () => {
    try {
      const result = await api.ping();
      setRiderId(result.rider_id);
      setRiderStatus(result.status);
      setRiderRejectReason(result.reject_reason);
      setRiderCreatedAt(result.created_at);
    } catch (err) {
      setRiderId(null);
      setRiderRejectReason(null);
      setRiderCreatedAt(null);
      // requireRider() 403s with error:'forbidden' specifically when no
      // riders row is linked to this login at all — anything else (network,
      // 500) is a real failure, not "hasn't applied yet".
      setRiderStatus(err instanceof Error && err.message === 'forbidden' ? 'no_application' : 'error');
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) checkRiderStatus().finally(() => setLoading(false));
      else setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        setLoading(true);
        checkRiderStatus().finally(() => setLoading(false));
      } else {
        setRiderStatus(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRiderId(null);
    setRiderStatus(null);
    setRiderRejectReason(null);
    setRiderCreatedAt(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        riderId,
        riderStatus,
        riderRejectReason,
        riderCreatedAt,
        riderActive: riderStatus === null ? null : riderStatus === 'active',
        loading,
        refreshRiderStatus: checkRiderStatus,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
