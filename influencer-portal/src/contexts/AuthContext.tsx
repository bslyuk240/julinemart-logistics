import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

interface Influencer {
  id: string;
  name: string;
  email: string;
  phone: string;
  platform: string;
  handle: string;
  coupon_code: string;
  shipping_discount_type: string;
  shipping_discount_value: number;
  minimum_order_value: number;
  maximum_uses: number | null;
  commission_rate: number;
  commission_based_on: string | null;
  tier: string;
  status: string;
  total_orders: number;
  total_sales: number;
  total_shipping_discounts: number;
  total_commission_earned: number;
  total_commission_paid: number;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  start_date: string | null;
  last_sale_date: string | null;
  created_at: string;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  influencer: Influencer | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshInfluencer: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]             = useState<User | null>(null);
  const [session, setSession]       = useState<Session | null>(null);
  const [influencer, setInfluencer] = useState<Influencer | null>(null);
  const [loading, setLoading]       = useState(true);

  const loadInfluencer = async () => {
    try {
      const data = await api.getProfile();
      setInfluencer(data);
    } catch {
      setInfluencer(null);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) loadInfluencer().finally(() => setLoading(false));
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        setLoading(true);
        loadInfluencer().finally(() => setLoading(false));
      } else {
        setInfluencer(null);
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
    setInfluencer(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, influencer, loading, signIn, signOut, refreshInfluencer: loadInfluencer }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
