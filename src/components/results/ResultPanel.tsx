import { useEffect, useRef, useState } from 'react'
import type { OCRResult, TextBlock } from '../../types/ocr'
import { detectLineWarnings } from '../../utils/lineWarnings'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface ResultPanelProps {
  result: OCRResult | null
  selectedBlock: TextBlock | null
  selectedPageBlockText?: string | null
  onEditBlock?: (block: TextBlock, newText: string) => void
  onMoveBlock?: (block: TextBlock, dir: 'up' | 'down') => void
  onReorderBlocks?: (orderedUids: string[]) => void
  onUndoReorder?: () => void
  canUndoReorder?: boolean
  lang: 'ja' | 'en'
}

interface SortableLineProps {
  block: TextBlock
  isActive: boolean
  checked: boolean
  dimmed: boolean
  warnTitle: string
  hasWarn: boolean
  rows: number
  canMoveUp: boolean
  canMoveDown: boolean
  lang: 'ja' | 'en'
  onToggle: (uid: string) => void
  onEdit: (block: TextBlock, text: string) => void
  onMove: (block: TextBlock, dir: 'up' | 'down') => void
}

/** textareaの高さを内容に合わせて自動調整する（定番のautosizeパターン）。 */
function autosizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** 1行分（チェックボックス＋⠿ハンドル＋⚠️＋textarea＋↑↓）。ドラッグはハンドルからのみ開始する。 */
function SortableLine({
  block, isActive, checked, dimmed, warnTitle, hasWarn, rows,
  canMoveUp, canMoveDown, lang, onToggle, onEdit, onMove,
}: SortableLineProps) {
  const uid = block.uid as string
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uid })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // マウント時・テキスト変更のたびに高さを再計測（ソフト折り返しで2行目以降が
  // 見切れないようにするため。横幅の変化はResultPanel側のResizeObserverが担当する）
  useEffect(() => {
    autosizeTextarea(textareaRef.current)
  }, [block.text])
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: dimmed || isDragging ? 0.35 : 1,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`line-row${isActive ? ' active' : ''}${hasWarn ? ' line-warn' : ''}${checked ? ' line-selected' : ''}`}
    >
      <input
        type="checkbox"
        className="line-check"
        checked={checked}
        onChange={() => onToggle(uid)}
        aria-label={lang === 'ja' ? 'この行を選択（まとめて移動）' : 'Select this line for group move'}
      />
      <button
        type="button"
        className="line-drag-handle"
        aria-label={lang === 'ja' ? 'ドラッグして読み順を変更' : 'Drag to reorder'}
        title={lang === 'ja' ? 'ドラッグして読み順を変更' : 'Drag to reorder'}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {hasWarn && (
        <span className="line-warn-mark" title={warnTitle}>⚠️</span>
      )}
      <textarea
        ref={textareaRef}
        className="line-edit"
        value={block.text}
        rows={rows}
        onChange={(e) => onEdit(block, e.target.value)}
        spellCheck={false}
      />
      <span className="line-move">
        <button
          type="button"
          className="line-move-btn"
          onClick={() => onMove(block, 'up')}
          disabled={!canMoveUp}
          title={lang === 'ja' ? '上へ（読み順を前に）' : 'Move up'}
        >↑</button>
        <button
          type="button"
          className="line-move-btn"
          onClick={() => onMove(block, 'down')}
          disabled={!canMoveDown}
          title={lang === 'ja' ? '下へ（読み順を後に）' : 'Move down'}
        >↓</button>
      </span>
    </li>
  )
}

/** 選択グループを1つ上/下へ動かした新しい順序を返す（端で止まる場合は null）。 */
function moveGroup(order: string[], sel: Set<string>, dir: 'up' | 'down'): string[] | null {
  const movingOrdered = order.filter((u) => sel.has(u))
  const remaining = order.filter((u) => !sel.has(u))
  const firstIdx = order.findIndex((u) => sel.has(u))
  let lastIdx = -1
  for (let i = order.length - 1; i >= 0; i--) {
    if (sel.has(order[i])) { lastIdx = i; break }
  }
  if (firstIdx < 0) return null
  if (dir === 'up') {
    if (firstIdx === 0) return null
    const aboveId = order[firstIdx - 1]
    const pos = remaining.indexOf(aboveId)
    return [...remaining.slice(0, pos), ...movingOrdered, ...remaining.slice(pos)]
  } else {
    if (lastIdx >= order.length - 1) return null
    const belowId = order[lastIdx + 1]
    const pos = remaining.indexOf(belowId)
    return [...remaining.slice(0, pos + 1), ...movingOrdered, ...remaining.slice(pos + 1)]
  }
}

export function ResultPanel({ result, selectedBlock, onEditBlock, onMoveBlock, onReorderBlocks, onUndoReorder, canUndoReorder, lang }: ResultPanelProps) {
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set())
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const movingUidsRef = useRef<string[]>([])
  const editorRef = useRef<HTMLOListElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // ページが切り替わったら選択をリセット（uidは安定なので同一ページ内の並べ替えでは維持される）
  useEffect(() => { setSelectedUids(new Set()) }, [result?.id])

  // 横幅が変わったら全行のtextareaを再計測する（ウィンドウリサイズ・パネル幅ドラッグの両方）。
  // パネル幅ドラッグはwindowのresizeイベントを発火しないため、コンテナの実サイズを見る
  // ResizeObserverを主とし、window resizeも保険で併用する。どちらも100msデバウンス。
  useEffect(() => {
    const recalcAll = () => {
      const container = editorRef.current
      if (!container) return
      container.querySelectorAll<HTMLTextAreaElement>('.line-edit').forEach(autosizeTextarea)
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleRecalc = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(recalcAll, 100)
    }
    const ro = new ResizeObserver(scheduleRecalc)
    if (editorRef.current) ro.observe(editorRef.current)
    window.addEventListener('resize', scheduleRecalc)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', scheduleRecalc)
      if (timer) clearTimeout(timer)
    }
  }, [result?.id])

  if (!result) {
    return (
      <div className="result-panel empty">
        <p>{lang === 'ja' ? '結果なし' : 'No results'}</p>
      </div>
    )
  }

  // 認識に失敗したページ：原因究明用にエラー詳細を表示する（textBlocksは空なので通常表示はしない）
  if (result.error) {
    return (
      <div className="result-panel">
        <div className="result-header">
          <span className="result-filename">{result.fileName}</span>
        </div>
        <div className="result-text">
          <p className="no-text">
            {lang === 'ja' ? '認識に失敗しました（画像のみで書き出されます）' : 'Recognition failed (exported as image only)'}
          </p>
          {result.errorMessage && (
            <pre className="result-error-detail">{result.errorMessage}</pre>
          )}
        </div>
      </div>
    )
  }

  // 読み順に並べた行（そのまま編集できる一覧にする）
  const lines = [...result.textBlocks].sort((a, b) => a.readingOrder - b.readingOrder)
  const warnings = detectLineWarnings(lines)
  const warnCount = warnings.filter((w) => w.length > 0).length
  const warnLabel = (w: string[]) => {
    const parts: string[] = []
    if (w.includes('continuity')) parts.push(lang === 'ja' ? '前の行とつながらない可能性（読み順を確認）' : 'May not connect to previous line (check order)')
    if (w.includes('bracket')) parts.push(lang === 'ja' ? '括弧の対応が取れていない可能性' : 'Unbalanced brackets')
    return parts.join(' / ')
  }

  const orderUids = lines.map((l) => l.uid as string)
  const firstSelIdx = orderUids.findIndex((u) => selectedUids.has(u))
  let lastSelIdx = -1
  for (let i = orderUids.length - 1; i >= 0; i--) {
    if (selectedUids.has(orderUids[i])) { lastSelIdx = i; break }
  }

  const toggleUid = (uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid); else next.add(uid)
      return next
    })
  }

  const handleMove = (block: TextBlock, dir: 'up' | 'down') => {
    const uid = block.uid as string
    if (selectedUids.has(uid) && onReorderBlocks) {
      const newOrder = moveGroup(orderUids, selectedUids, dir)
      if (newOrder) onReorderBlocks(newOrder)
    } else if (onMoveBlock) {
      onMoveBlock(block, dir)
    }
  }

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    // 選択済みの行を掴んだら選択行すべて／未選択行なら1行のみを移動対象にする
    const moving = selectedUids.has(id) ? orderUids.filter((u) => selectedUids.has(u)) : [id]
    movingUidsRef.current = moving
    setActiveUid(id)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    const moving = movingUidsRef.current
    movingUidsRef.current = []
    setActiveUid(null)
    if (!overId || !onReorderBlocks) return
    const movingSet = new Set(moving)
    // ドラッグ対象内部（掴んだグループの行の上）へのドロップは何もしない
    if (movingSet.has(overId)) return
    const remaining = orderUids.filter((u) => !movingSet.has(u))
    const movingOrdered = orderUids.filter((u) => movingSet.has(u))
    const activeIndex = orderUids.indexOf(activeId)
    const overIndex = orderUids.indexOf(overId)
    const insertAfter = activeIndex < overIndex
    const overPos = remaining.indexOf(overId)
    const insertPos = insertAfter ? overPos + 1 : overPos
    const newOrder = [...remaining.slice(0, insertPos), ...movingOrdered, ...remaining.slice(insertPos)]
    if (newOrder.every((u, i) => u === orderUids[i])) return // 変化なし
    onReorderBlocks(newOrder)
  }

  const handleDragCancel = () => {
    movingUidsRef.current = []
    setActiveUid(null)
  }

  const activeMovingSet = new Set(movingUidsRef.current)
  const movingCount = movingUidsRef.current.length

  return (
    <div className="result-panel">
      <div className="result-header">
        <span className="result-filename">{result.fileName}</span>
        <span className="result-stats">
          {result.textBlocks.length}
          {lang === 'ja' ? ' 行' : ' lines'}
          {' · '}
          {(result.processingTimeMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="result-text">
        {lines.length === 0 ? (
          <p className="no-text">
            {lang === 'ja' ? 'テキストが検出されませんでした' : 'No text detected'}
          </p>
        ) : onEditBlock ? (
          <>
            <div className="edit-hint">
              {lang === 'ja'
                ? '行はそのまま編集できます。⠿をドラッグ、または↑↓で読み順を変更（チェックで複数行をまとめて移動）'
                : 'Edit lines directly. Drag ⠿ or use ↑↓ to reorder (check boxes to move multiple lines together).'}
            </div>
            {onUndoReorder && (
              <div className="reorder-undo-bar">
                <button
                  type="button"
                  className="reorder-undo-btn"
                  onClick={onUndoReorder}
                  disabled={!canUndoReorder}
                  title={lang === 'ja'
                    ? '読み順の変更を元に戻す（Ctrl+Z。文字の編集はテキスト欄の中でCtrl+Z）'
                    : 'Undo reading-order change (Ctrl+Z. To undo text edits, press Ctrl+Z inside the text field)'}
                >
                  {lang === 'ja' ? '↩ 元に戻す' : '↩ Undo'}
                </button>
              </div>
            )}
            {warnCount > 0 && (
              <div className="warn-summary">
                {lang === 'ja'
                  ? `⚠️ 要確認の箇所が ${warnCount} 件あります（読み順・括弧の乱れの疑い。⚠️の行を確認してください）`
                  : `⚠️ ${warnCount} line(s) flagged for review (possible order/bracket issues)`}
              </div>
            )}
            {selectedUids.size > 0 && (
              <div className="line-select-toolbar">
                <span>
                  {lang === 'ja'
                    ? `${selectedUids.size}行を選択中（⠿をつかんでまとめて移動）`
                    : `${selectedUids.size} line(s) selected (grab ⠿ to move together)`}
                </span>
                <button
                  type="button"
                  className="line-select-clear"
                  onClick={() => setSelectedUids(new Set())}
                >
                  {lang === 'ja' ? '選択解除' : 'Clear'}
                </button>
              </div>
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext items={orderUids} strategy={verticalListSortingStrategy}>
                <ol className="line-editor" ref={editorRef}>
                  {lines.map((b, i) => {
                    const uid = b.uid as string
                    const isActive = !!selectedBlock?.uid && selectedBlock.uid === uid
                    const rows = Math.max(1, b.text.split('\n').length)
                    const w = warnings[i]
                    const checked = selectedUids.has(uid)
                    // 選択中はグループ端で、未選択は行位置で↑↓の可否を決める
                    const canMoveUp = checked ? firstSelIdx > 0 : i > 0
                    const canMoveDown = checked ? lastSelIdx < lines.length - 1 : i < lines.length - 1
                    return (
                      <SortableLine
                        key={uid}
                        block={b}
                        isActive={isActive}
                        checked={checked}
                        dimmed={activeUid !== null && activeMovingSet.has(uid)}
                        warnTitle={warnLabel(w)}
                        hasWarn={w.length > 0}
                        rows={rows}
                        canMoveUp={canMoveUp}
                        canMoveDown={canMoveDown}
                        lang={lang}
                        onToggle={toggleUid}
                        onEdit={onEditBlock}
                        onMove={handleMove}
                      />
                    )
                  })}
                </ol>
              </SortableContext>
              <DragOverlay>
                {activeUid !== null ? (
                  <div className="line-drag-chip">
                    {lang === 'ja'
                      ? `${movingCount}行を移動中`
                      : `Moving ${movingCount} line${movingCount > 1 ? 's' : ''}`}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </>
        ) : (
          <pre className="full-text">{result.fullText}</pre>
        )}
      </div>
    </div>
  )
}
