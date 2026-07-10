import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

function isValidSupabaseUrl(value) {
  if (!value) return false

  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const placeholderPattern = /your-|project-ref|anon-key|change_me/i
const hasSupabaseCredentials = Boolean(supabaseUrl && supabaseAnonKey)
const hasPlaceholderCredentials = placeholderPattern.test(supabaseUrl || '')
  || placeholderPattern.test(supabaseAnonKey || '')
const hasValidSupabaseUrl = isValidSupabaseUrl(supabaseUrl)

export const isSupabaseConfigured = hasSupabaseCredentials
  && hasValidSupabaseUrl
  && !hasPlaceholderCredentials

export const supabaseConfigError = isSupabaseConfigured
  ? null
  : !hasSupabaseCredentials
    ? 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart Vite.'
    : !hasValidSupabaseUrl
      ? 'VITE_SUPABASE_URL must be a valid http:// or https:// Supabase URL.'
      : 'Replace the placeholder Supabase URL and anon key with real values from your Supabase project.'

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export function getSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError)
  }

  return supabase
}
