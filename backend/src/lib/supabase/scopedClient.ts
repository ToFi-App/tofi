import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from '../fetchTimeout.js'

export function getScopedClient(jwt: string): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    // Without this, a stalled PostgREST connection hangs the invocation indefinitely — see
    // lib/fetchTimeout.ts.
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: fetchWithTimeout() },
  })
}
