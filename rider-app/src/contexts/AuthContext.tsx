import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  riderId: string | null;
  riderActive: boolean | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [riderId, setRiderId] = useState<string | null>(null);
  const [riderActive, setRiderActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // rider-ping doubles as "is this token tied to an active riders row" and
  // carries the rider's own id (distinct from the auth user id) for
  // endpoints keyed on riders.id, like push token registration.
  const checkRiderStatus = async () => {
    try {
      const result = await api.ping();
      setRiderId(result.rider_id);
      setRiderActive(result.status === 'active');
    } catch {
      setRiderId(null);
      setRiderActive(false);
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
        setRiderActive(null);
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
    setRiderActive(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, riderId, riderActive, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
