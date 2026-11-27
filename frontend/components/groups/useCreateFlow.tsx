import { useState, type ReactNode } from 'react'
import type { WriteAnchor } from '@/components/home/HomeHeader'
import { useTransactionEditorActions } from '@/components/transactions/TransactionEditorProvider'
import { useGroupsMenuSeen } from '@/hooks/useGroupsMenuSeen'
import { CreateMenu } from './CreateMenu'
import { GroupSheet } from './GroupSheet'
import { NewGroupSheet } from './NewGroupSheet'

/**
 * The Calendar header's "+": New transaction or New group (docs/transaction-groups.md §4). Home
 * has no write button, so this is the one place new transactions and groups start. Returns the
 * props to spread on HomeHeader, an `openGroup` for anything else that opens a group (the Groups
 * card and row pills), and the menu and sheets to render once at the screen's root.
 *
 * The button carries a dot until the menu has been opened once; opening it clears it for good.
 */
export function useCreateFlow(): {
  headerProps: { onWrite: (anchor: WriteAnchor) => void; writeDot: boolean }
  openGroup: (groupId: string) => void
  elements: ReactNode
} {
  const { openNewManual } = useTransactionEditorActions()
  const [menuAnchor, setMenuAnchor] = useState<WriteAnchor | null>(null)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const menuSeen = useGroupsMenuSeen()
  // Captured at open, because opening is also what marks the menu seen: read live, the NEW tag
  // would vanish in the same render that showed it.
  const [menuShowsNew, setMenuShowsNew] = useState(false)

  const onWrite = (anchor: WriteAnchor) => {
    setMenuShowsNew(!menuSeen.seen)
    setMenuAnchor(anchor)
    if (!menuSeen.seen) menuSeen.markSeen()
  }

  const elements = (
    <>
      <CreateMenu
        anchor={menuAnchor}
        showNewBadge={menuShowsNew}
        onClose={() => setMenuAnchor(null)}
        onNewTransaction={() => {
          setMenuAnchor(null)
          openNewManual()
        }}
        onNewGroup={() => {
          setMenuAnchor(null)
          setNewGroupOpen(true)
        }}
      />
      <NewGroupSheet
        visible={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        onCreated={(groupId) => {
          setNewGroupOpen(false)
          setOpenGroupId(groupId)
        }}
      />
      <GroupSheet groupId={openGroupId} onClose={() => setOpenGroupId(null)} />
    </>
  )

  return { headerProps: { onWrite, writeDot: !menuSeen.seen }, openGroup: setOpenGroupId, elements }
}
