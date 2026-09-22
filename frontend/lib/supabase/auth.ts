import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin'
import * as AppleAuthentication from 'expo-apple-authentication'
import { createClient, type Session } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { reportError } from '@/lib/observability/log'
import { fetchWithTimeout } from '@/lib/api/fetchTimeout'

// Auth only: sign in, session, refresh — no data queries (see architecture.md). reportError is
// the one deliberate exception: it dynamically imports the api client only inside a failure
// path, so a sign-in failure gets the same off-device visibility a background failure does,
// without giving this module a real dependency on the query layer.
// Apple and Google are the identity providers; the Email provider is disabled in the Supabase
// dashboard, so there is no password path to fall back to.

// THIS_DEVICE_ONLY keeps the session out of iCloud/iTunes backups — the default WHEN_UNLOCKED
// class lets a restored backup carry the refresh token onto another device, sidestepping
// usePurgeSessionOnFreshInstall. AFTER_FIRST_UNLOCK rather than WHEN_UNLOCKED because the
// budget-alert background task is woken by iOS while the device is idle — usually locked — and
// under WHEN_UNLOCKED it could not read the session, so it bailed before syncing anything.
const KEYCHAIN_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }

// The accessibility class is fixed when an item is written, so the change above does not reach a
// session already on disk from an older build — it stays invisible to the background task until
// something rewrites it. Rewriting once per launch, on the first read of each key, costs one
// keychain write and moves that from "the next token refresh" to "the next app open". It cannot
// clobber a newer value: supabase serialises session storage access behind its own lock, and the
// rewrite is awaited inside the getItem call that lock is held for.
const rewrittenKeys = new Set<string>()

// expo-secure-store has no web implementation (iOS is the only shipped platform
// per architecture.md) — fall back to localStorage so the app doesn't crash when
// previewed via `expo start --web`, and no-op under SSR where window is undefined.
const SecureStoreAdapter = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null
    const value = await SecureStore.getItemAsync(key)
    if (value !== null && !rewrittenKeys.has(key)) {
      rewrittenKeys.add(key)
      await SecureStore.setItemAsync(key, value, KEYCHAIN_OPTIONS)
    }
    return value
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === 'web') return Promise.resolve(globalThis.localStorage?.setItem(key, value))
    return SecureStore.setItemAsync(key, value, KEYCHAIN_OPTIONS)
  },
  removeItem: (key: string) => {
    if (Platform.OS === 'web') return Promise.resolve(globalThis.localStorage?.removeItem(key))
    return SecureStore.deleteItemAsync(key)
  },
}

export const supabaseAuth = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: SecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    // Without this, a stalled token refresh (this client's own network call, not one that goes
    // through lib/api/client.ts) can hang indefinitely — the same "app hanging" failure mode
    // this whole observability effort exists to catch, reachable from a path fetchWithNetworkRetry
    // never sees, since httpBatchLink's headers() callback (which calls getSession(), which can
    // trigger this exact refresh) runs and is awaited before fetchWithNetworkRetry is ever called.
    global: { fetch: fetchWithTimeout() },
  },
)

// `webClientId` is not about a web build: Supabase validates the ID token's `aud` against
// the Web OAuth client registered on its Google provider, so the token must be minted for
// that client even though sign-in happens through the iOS one.
GoogleSignin.configure({
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
})

// Returns null when the user dismisses the Google sheet — a cancel is not a failure, and
// surfacing it as one would flash an error banner at someone who just tapped outside.
// The SDK reports a dismissal as a `cancelled` response rather than a rejection, but a
// stale cached credential still rejects with SIGN_IN_CANCELLED, so both are handled.
export async function signInWithGoogle() {
  let idToken: string
  try {
    const response = await GoogleSignin.signIn()
    if (response.type === 'cancelled') return null
    if (!response.data.idToken) throw new Error('Google did not return an ID token.')
    idToken = response.data.idToken
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return null
    throw err
  }

  try {
    const { data, error } = await supabaseAuth.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    })
    if (error) throw error
    return data
  } catch (err) {
    // A platform-wide Supabase outage looks identical to an isolated bad connection from here —
    // reportError is what turns a handful of these into a visible pattern. See its own doc.
    reportError('auth-sign-in', err, { provider: 'google' })
    throw err
  }
}

// The App Store requires Sign in with Apple alongside any third-party login (guideline 4.8).
// Same shape as Google: native sheet mints an identity token, Supabase's Apple provider
// verifies it against this app's bundle id. Returns null on cancel — tapping outside the
// sheet is not a failure. Apple only shares full name/email on the FIRST authorization, so
// nothing here depends on them; Supabase reads what the token carries.
export async function signInWithApple() {
  let identityToken: string
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    })
    if (!credential.identityToken) throw new Error('Apple did not return an identity token.')
    identityToken = credential.identityToken
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ERR_REQUEST_CANCELED') return null
    // Any other ERR_* means the sheet failed before Apple issued a token — most commonly a
    // device with no Apple ID signed in. The raw exception text is developer-speak; the
    // banner should say something a person can act on.
    if (typeof code === 'string' && code.startsWith('ERR_')) {
      throw new Error('Apple sign-in didn’t complete. Make sure this device is signed in to an Apple ID, then try again.')
    }
    throw err
  }

  try {
    const { data, error } = await supabaseAuth.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
    })
    if (error) throw error
    return data
  } catch (err) {
    reportError('auth-sign-in', err, { provider: 'apple' })
    throw err
  }
}

// Google's own session is cleared too, not just Supabase's. Left signed in, the SDK would
// hand back the previous account without a picker on the next tap, so signing out and back
// in could never switch accounts.
export async function signOut() {
  await GoogleSignin.signOut()
  const { error } = await supabaseAuth.auth.signOut()
  if (error) throw error
}

/**
 * Ends the session on this device only, without asking the auth server to revoke it.
 *
 * For the one case where the account no longer exists: after deletion the server has already
 * invalidated everything, and a normal `signOut()` — which calls the server — can come back an
 * error for the missing user and throw. That would leave a local session pointing at a deleted
 * account, i.e. the user still "signed in" to nothing. `scope: 'local'` skips the server call,
 * which is all that is left to do anyway.
 *
 * Still emits SIGNED_OUT, so `useResetCacheOnUserChange` clears the query and MMKV caches.
 */
export async function clearLocalSession() {
  await GoogleSignin.signOut()
  await supabaseAuth.auth.signOut({ scope: 'local' })
}

interface SessionState {
  session: Session | null
  isLoading: boolean
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, isLoading: true })

  useEffect(() => {
    supabaseAuth.auth.getSession().then(({ data }) => {
      setState({ session: data.session, isLoading: false })
    })

    const { data: listener } = supabaseAuth.auth.onAuthStateChange((_event, session) => {
      setState({ session, isLoading: false })
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  return state
}
