// Values mirror constants/theme.ts exactly (kept in plain JS here since Tailwind's
// config loader runs outside Metro/Babel and can't resolve the TS import).

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // The app is light-mode-only by design (design.md, pivoted 2026-08) — no `dark:`
  // variants are used anywhere, so this just satisfies NativeWind's manual-color-scheme
  // requirement (app.json's userInterfaceStyle otherwise crashes on web with "media" mode).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#FAFAF8',
        surface: '#FFFFFF',
        surfaceRaised: '#F3F3EF',
        border: '#E8E8E2',
        borderStrong: '#D3D3CA',

        primary: '#0F766E',
        primaryDim: '#0B5C56',
        primaryMuted: 'rgba(15,118,110,0.10)',
        primaryHairline: 'rgba(15,118,110,0.16)',

        income: '#059669',
        expense: '#E11D48',
        warning: '#B45309',
        reimbursed: '#7C3AED',

        textPrimary: '#1C1C18',
        textSecondary: '#6E6E64',
        textMuted: '#A8A89C',
        textInverse: '#FFFFFF',

        category: {
          foodAndDrink: '#F97316',
          transport: '#3B82F6',
          travel: '#8B5CF6',
          entertainment: '#EC4899',
          shopping: '#EAB308',
          bills: '#6B7280',
          health: '#10B981',
          personalCare: '#F43F5E',
          home: '#84CC16',
          services: '#06B6D4',
          income: '#34D399',
          transfersIn: '#2DD4BF',
          transfersOut: '#9CA3AF',
          loans: '#F87171',
          fees: '#6B7280',
          other: '#71717A',
        },
      },
      fontFamily: {
        display: ['DMSans_700Bold'],
        sans: ['Inter_400Regular'],
        sansMed: ['Inter_500Medium'],
        sansSemi: ['Inter_600SemiBold'],
        mono: ['JetBrainsMono_400Regular'],
      },
      fontSize: {
        xs: '11px',
        sm: '13px',
        amount: '14px',
        base: '15px',
        md: '17px',
        lg: '22px',
        xl: '28px',
        '2xl': '36px',
        '3xl': '48px',
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        8: '32px',
        10: '40px',
        12: '48px',
      },
      borderRadius: {
        sm: '8px',
        md: '14px',
        lg: '20px',
        xl: '28px',
        full: '9999px',
      },
    },
  },
  plugins: [],
}
