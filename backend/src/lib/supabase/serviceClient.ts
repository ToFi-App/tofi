import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from '../fetchTimeout.js'

let client: SupabaseClient | undefined

export function getServiceClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    }
    // Without this, a stalled Postgres/PostgREST connection hangs the invocation indefinitely —
    // see lib/fetchTimeout.ts.
    client = createClient(url, serviceKey, { auth: { persistSession: false }, global: { fetch: fetchWithTimeout() } })
  }
  return client
}
