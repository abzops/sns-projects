import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export function useProfile() {
  const { user } = useAuth()
  const userId = user?.id || null
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const supabase = getSupabase()
    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, created_at, updated_at')
      .eq('id', userId)
      .single()

    setProfile(data || null)
    setError(fetchError)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const updateProfile = async (updates) => {
    const supabase = getSupabase()
    const { error: updateError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)

    if (!updateError) {
      await fetchProfile()
    }

    return { error: updateError }
  }

  return { profile, loading, error, updateProfile, refetch: fetchProfile }
}
