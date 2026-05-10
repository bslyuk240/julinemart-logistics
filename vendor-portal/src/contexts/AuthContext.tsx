import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

interface Vendor {
  id: string;
  store_name: string;
  store_slug: string;
  email: string;
  phone: string;
  commission_rate: number;
  logo_url: string | null;
  banner_url: string | null;
  description: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  address: string | null;
  city: string;
  state: string;
  lga: string | null;
  fez_collection_method: 'fez_pickup' | 'hub_dropoff' | null;
  approved_location_id: string | null;
  hub_id: string | null;
  approved_vendor_locations: {
    fez_hub_name: string | null;
    fez_hub_address: string | null;
    vendor_pickup_surcharge: number | null;
    hubs: { name: string; address: string | null; city: string | null } | null;
  } | null;
  woocommerce_vendor_id: string;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  vendor: Vendor | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshVendor: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [vendor, setVendor]   = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);

  const loadVendor = async () => {
    try {
      const data = await api.getProfile();
      setVendor(data);
    } catch {
      setVendor(null);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) loadVendor().finally(() => setLoading(false));
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        setLoading(true);
        loadVendor().finally(() => setLoading(false));
      } else {
        setVendor(null);
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
    setVendor(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, vendor, loading, signIn, signOut, refreshVendor: loadVendor }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
