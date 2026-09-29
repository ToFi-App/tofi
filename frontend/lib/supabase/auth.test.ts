import { afterEach, describe, expect, it, vi } from 'vitest'

// react-native's own source has Flow syntax Vite's SSR transform can't parse (the reason
// client.test.ts stubs this module out entirely rather than importing auth.ts for real).
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))

const signInWithIdTokenMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithIdToken: signInWithIdTokenMock,
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}))

const googleSignInMock = vi.fn()
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: vi.fn(), signIn: googleSignInMock, signOut: vi.fn() },
  isErrorWithCode: (err: unknown): err is { code: string } =>
    typeof err === 'object' && err !== null && 'code' in err,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}))

const appleSignInMock = vi.fn()
vi.mock('expo-apple-authentication', () => ({
  signInAsync: appleSignInMock,
  AppleAuthenticationScope: { FULL_NAME: 'FULL_NAME', EMAIL: 'EMAIL' },
}))

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}))

const reportErrorMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/observability/log', () => ({ reportError: reportErrorMock }))

const { signInWithGoogle, signInWithApple } = await import('./auth')

describe('signInWithGoogle', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reports and rethrows when Supabase rejects the Google ID token', async () => {
    googleSignInMock.mockResolvedValue({ type: 'success', data: { idToken: 'google-token' } })
    const supabaseError = new Error('fetch failed')
    signInWithIdTokenMock.mockResolvedValue({ data: null, error: supabaseError })

    await expect(signInWithGoogle()).rejects.toBe(supabaseError)

    expect(reportErrorMock).toHaveBeenCalledWith('auth-sign-in', supabaseError, { provider: 'google' })
  })

  it('does not report a cancellation from the Google sheet itself', async () => {
    googleSignInMock.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' })

    await expect(signInWithGoogle()).resolves.toBeNull()

    expect(signInWithIdTokenMock).not.toHaveBeenCalled()
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})

describe('signInWithApple', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reports and rethrows when Supabase rejects the Apple identity token', async () => {
    appleSignInMock.mockResolvedValue({ identityToken: 'apple-token' })
    const supabaseError = new Error('The network connection was lost.')
    signInWithIdTokenMock.mockResolvedValue({ data: null, error: supabaseError })

    await expect(signInWithApple()).rejects.toBe(supabaseError)

    expect(reportErrorMock).toHaveBeenCalledWith('auth-sign-in', supabaseError, { provider: 'apple' })
  })

  it('does not report a cancellation from the Apple sheet itself', async () => {
    appleSignInMock.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' })

    await expect(signInWithApple()).resolves.toBeNull()

    expect(signInWithIdTokenMock).not.toHaveBeenCalled()
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})
