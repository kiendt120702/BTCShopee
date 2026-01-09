/**
 * AuthContext - Share auth state across all components
 * Giải quyết vấn đề mỗi useAuth() tạo state riêng
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  work_type: 'fulltime' | 'parttime';
  join_date: string | null;
  created_at: string;
  updated_at: string;
  role_display_name?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ success: boolean; needsConfirmation?: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  clearError: () => void;
  updateProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function getUserProfile(userId: string): Promise<Profile | null> {
  const { data: profileData, error: profileError } = await supabase
    .from('sys_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profileError) {
    if (profileError.code === 'PGRST116') {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: newProfile, error: insertError } = await supabase
        .from('sys_profiles')
        .insert({
          id: userId,
          email: user?.email || '',
          full_name: user?.user_metadata?.full_name || '',
          work_type: 'fulltime',
        })
        .select('*')
        .single();

      if (insertError) return null;

      return {
        ...newProfile,
        role_display_name: newProfile.work_type === 'fulltime' ? 'Full-time' : 'Part-time',
      };
    }

    return null;
  }

  return {
    ...profileData,
    role_display_name: profileData.work_type === 'fulltime' ? 'Full-time' : 'Part-time',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async (userId: string) => {
    const profileData = await getUserProfile(userId);
    setProfile(profileData);
    setIsLoading(false);
  };

  useEffect(() => {
    let mounted = true;

    // Set up auth state listener FIRST (before getSession)
    // This ensures we don't miss any auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;
        
        console.log('[Auth] Event:', event, 'Session:', !!newSession);

        // Handle all session-related events
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          if (newSession?.user) {
            setSession(newSession);
            setUser(newSession.user);
            // Only load profile on SIGNED_IN or INITIAL_SESSION, not on TOKEN_REFRESHED
            if (event !== 'TOKEN_REFRESHED') {
              await loadProfile(newSession.user.id);
            } else {
              setIsLoading(false);
            }
          } else if (event === 'INITIAL_SESSION') {
            // No session on initial load
            setSession(null);
            setUser(null);
            setIsLoading(false);
          }
        } else if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
          setProfile(null);
          setIsLoading(false);
        }
      }
    );

    // Then get the initial session
    // The INITIAL_SESSION event will be fired by onAuthStateChange
    supabase.auth.getSession().then(({ data: { session: initialSession }, error }) => {
      if (!mounted) return;
      
      if (error) {
        console.error('[Auth] getSession error:', error);
        setSession(null);
        setUser(null);
        setIsLoading(false);
        return;
      }

      // If no INITIAL_SESSION event was fired (edge case), handle it here
      if (initialSession?.user && !user) {
        setSession(initialSession);
        setUser(initialSession.user);
        loadProfile(initialSession.user.id);
      } else if (!initialSession && isLoading) {
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (error) throw error;

      setUser(data.user);
      setSession(data.session);
      setIsLoading(false);

      return { success: true, needsConfirmation: !data.session };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Đăng ký thất bại';
      setError(message);
      setIsLoading(false);
      return { success: false, error: message };
    }
  };

  const signIn = async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      setUser(data.user);
      setSession(data.session);
      setIsLoading(false);

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Đăng nhập thất bại';
      setError(message);
      setIsLoading(false);
      return { success: false, error: message };
    }
  };

  const signOut = async () => {
    setIsLoading(true);

    try {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
      setProfile(null);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Đăng xuất thất bại';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const clearError = () => setError(null);

  const updateProfile = async () => {
    if (user) {
      await loadProfile(user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isAuthenticated: !!session,
        isLoading,
        error,
        signUp,
        signIn,
        signOut,
        clearError,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
