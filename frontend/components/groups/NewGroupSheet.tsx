import { useEffect, useState } from 'react'
import { reportError } from '@/lib/observability/log'
import { View } from 'react-native'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { SheetHeader } from '@/components/ui/SheetHeader'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { useTransactionGroups } from '@/hooks/useTransactionGroups'
import { nextGroupColor } from '@/lib/groups/groups'

/**
 * "New group" from the Calendar's "+" menu: a name and nothing else. The colour is picked for the
 * user (nextGroupColor) and the icon left generic, both changeable later, so starting a group is one
 * field and one tap. On create it hands back the new id, and the caller opens that group's sheet on
 * its empty state, whose one action is adding transactions.
 */
export function NewGroupSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (groupId: string) => void }) {
  const sheetScroll = useSheetScroll()
  const groups = useTransactionGroups()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (visible) {
      setName('')
      setError(null)
    }
  }, [visible])

  const trimmed = name.trim()

  async function create() {
    if (!trimmed) return
    setError(null)
    try {
      const group = await groups.create({ name: trimmed, color: nextGroupColor(groups.groups), icon: null })
      onCreated(group.id)
    } catch (err) {
      reportError('group-create', err)
      setError("Couldn't create the group. Try again.")
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} contentScroll={sheetScroll}>
      <SheetHeader title="New group" onClose={onClose} />
      <View className="gap-4 px-5 pb-8">
        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Tahoe ski trip"
          autoFocus
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={() => void create()}
        />
        <Button label="Create group" onPress={() => void create()} disabled={!trimmed} loading={groups.isSaving} />
      </View>
    </BottomSheet>
  )
}
