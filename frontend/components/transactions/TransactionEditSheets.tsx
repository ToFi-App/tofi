import { useEffect } from 'react'
import { View } from 'react-native'
import { BottomSheet, useSheetScroll } from '@/components/ui/BottomSheet'
import { TransactionDetailSheet } from '@/components/transactions/TransactionDetailSheet'
import { ManualTransactionSheet } from '@/components/transactions/ManualTransactionSheet'
import { TransferSheet } from '@/components/transfers/TransferSheet'
import type { TransactionEditor } from '@/hooks/useTransactionEditor'
import { activeSheetOf, type ActiveSheet } from '@/lib/transfers/transferReturn'

interface TransactionEditSheetsProps {
  editor: TransactionEditor
}

/**
 * ONE bottom sheet, three contents.
 *
 * These were three separate <BottomSheet>es, and so three separate native <Modal>s. iOS cannot
 * reliably present one modal while another is dismissing, which is why the editor used to close
 * the first sheet, wait out a hardcoded 350ms, and only then open the second — on top of the new
 * sheet's own 350ms entrance. Marking a transfer cost the better part of a second of watching
 * nothing happen.
 *
 * With a single host the modal never leaves the screen during a handoff: only the content inside
 * it swaps, so the transition costs one render. That is what let the timeouts go entirely, and
 * with them the bug where a stale timer reopened a sheet the user had already dismissed.
 *
 * The manual sheet is HIDDEN rather than unmounted while another content shows. It keeps unsaved
 * form values across a trip to the transfer sheet (see its returningFromTransfer ref), and
 * unmounting would throw them away. The other two hold no state worth preserving — both already
 * re-seed from their item, and both render null when they have none, so leaving them in the tree
 * costs nothing.
 */
export function TransactionEditSheets({ editor }: TransactionEditSheetsProps) {
  // One tracker for the host, handed to whichever content is showing. Each content still owns its
  // own ScrollView; this is only how the sheet learns whether that scrollable sits at the top.
  const sheetScroll = useSheetScroll()

  // Derived by the same function the editor's transfer-return invariant is tested against, so
  // "which sheet is showing" has one definition rather than two that can drift.
  const active: ActiveSheet | null = activeSheetOf({
    detailItem: editor.activeSheetItem,
    transferItem: editor.transferItem,
    manualOpen: editor.manualSheetOpen,
  })

  const onClose =
    active === 'transfer'
      ? editor.declineTransfer
      : active === 'detail'
        ? editor.closeDetailSheet
        : editor.closeManualSheet

  return (
    <BottomSheet visible={active != null} onClose={onClose} contentScroll={sheetScroll}>
      {/* Keyed by transaction: opening a linked one swaps the item in place, and the new one should
          start at the top with its own form state, as if opened from the list. */}
      <TransactionDetailSheet
        key={editor.activeSheetItem?.id ?? 'none'}
        sheetScroll={sheetScroll}
        item={editor.activeSheetItem}
        categories={editor.categories}
        subcategories={editor.subcategories}
        pendingTransfer={editor.pendingTransfer}
        isSaving={editor.isSavingDetail}
        onClose={editor.closeDetailSheet}
        onSave={editor.saveCategory}
        onOpenTransfer={editor.openTransfer}
        onClearPendingTransfer={editor.clearPendingTransfer}
        onUnmarkTransfer={editor.unmarkTransfer}
        onUnlink={editor.unlink}
        onOpenLink={editor.openLink}
      />
      <TransferSheet
        sheetScroll={sheetScroll}
        item={editor.transferItem}
        candidateItems={editor.transferCandidateItems}
        accounts={editor.accounts}
        forcedKind={editor.transferForcedKind}
        onClose={editor.declineTransfer}
        onSave={editor.confirmTransfer}
      />
      {/* display:none rather than a conditional render — see the note above about unsaved values.
          flex:1 so the form fills the sheet exactly as it does when it is the only content. */}
      <View style={{ display: active === 'manual' ? 'flex' : 'none', flex: 1 }}>
        <ManualTransactionSheet
          visible={editor.manualSheetOpen}
          sheetScroll={sheetScroll}
          transaction={editor.editingManual ?? undefined}
          categories={editor.categories}
          subcategories={editor.subcategories}
          isSaving={editor.isSavingManual}
          onClose={editor.closeManualSheet}
          onSave={editor.saveManual}
          onDelete={editor.editingManual ? editor.deleteManual : undefined}
          isTransfer={editor.editingManualIsTransfer}
          isReimbursed={editor.editingManualIsReimbursed}
          pendingTransfer={editor.pendingTransfer}
          onOpenTransfer={editor.openManualTransfer}
          onClearPendingTransfer={editor.clearPendingTransfer}
          onSaveAndUnmarkTransfer={editor.saveManualAndUnmarkTransfer}
        />
      </View>
    </BottomSheet>
  )
}
