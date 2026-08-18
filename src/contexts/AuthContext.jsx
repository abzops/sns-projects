import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getSupabase, supabaseConfigError } from '../lib/supabase'
import { reconcileAuthUser } from '../lib/authGate'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    if (supabaseConfigError) {
      setLoading(false)
      return undefined
    }

    const supabase = getSupabase()

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      setUser((currentUser) =>
        reconcileAuthUser(currentUser, nextSession?.user ?? null, event)
      )
      setLoading(false)
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const signUp = async (email, password, fullName) => {
    if (supabaseConfigError) {
      return { error: new Error(supabaseConfigError) }
    }

    const supabase = getSupabase()
    return supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    })
  }

  const signIn = async (email, password) => {
    if (supabaseConfigError) {
      return { error: new Error(supabaseConfigError) }
    }

    const supabase = getSupabase()
    return supabase.auth.signInWithPassword({ email, password })
  }

  const signOut = async () => {
    if (supabaseConfigError) {
      setUser(null)
      setSession(null)
      return { error: null }
    }

    const supabase = getSupabase()
    return supabase.auth.signOut()
  }

  const refreshSession = async () => {
    if (supabaseConfigError) {
      return { data: null, error: null }
    }
    const supabase = getSupabase()
    const { data, error } = await supabase.auth.refreshSession()
    if (data?.session) {
      setSession(data.session)
      setUser((currentUser) =>
        reconcileAuthUser(currentUser, data.session.user ?? null, 'TOKEN_REFRESHED')
      )
    }
    return { data, error }
  }

  const updatePassword = async (newPassword) => {
    if (supabaseConfigError) {
      return { error: new Error(supabaseConfigError) }
    }
    const supabase = getSupabase()
    return supabase.auth.updateUser({ password: newPassword })
  }

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signUp,
      signIn,
      signOut,
      refreshSession,
      updatePassword,
      configError: supabaseConfigError,
    }),
    [user, session, loading]
  )

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  return useContext(AuthContext)
}
