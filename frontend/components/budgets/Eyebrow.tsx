import { Text } from 'react-native'

/** Mono instrument label — the Accounts tab's TOTAL ASSETS and section headers, reused here. */
export function Eyebrow({ children }: { children: string }) {
  return (
    <Text className="font-mono text-xs uppercase text-textSecondary" style={{ letterSpacing: 1.6 }}>
      {children}
    </Text>
  )
}
