import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { OCRResult, TextBlock, PageBlock } from './types/ocr'
import type { DBRunEntry } from './types/db'
import { useI18n } from './hooks/useI18n'
import { useOCRWorker } from './hooks/useOCRWorker'
import { useFileProcessor } from './hooks/useFileProcessor'
import { useResultCache } from './hooks/useResultCache'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { WelcomeScreen } from './components/WelcomeScreen'
import { ProgressBar } from './components/progress/ProgressBar'
import { ImageViewer } from './components/viewer/ImageViewer'
import { ResultPanel } from './components/results/ResultPanel'
import { ResultActions } from './components/results/ResultActions'
import { HistoryPanel } from './components/results/HistoryPanel'
import { SettingsModal } from './components/settings/SettingsModal'
import { imageDataToDataUrl } from './utils/imageLoader'
import { countPageWarnings } from './utils/lineWarnings'
import { getDraft, saveDraftText, saveDraftImages, clearDraft } from './utils/db'
import { ensureBlockUids } from './utils/blockUid'
import type { ProcessedImage } from './types/ocr'
import type { Orientation } from './utils/exporters/pdfExport'
import './App.css'

/** data URL → ImageData（一時保存の復元時にフル画像を復号） */
function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, c.width, c.height))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

/**
 * 渡された uid 順に readingOrder を 1..n で振り直し、fullText を再構成する。
 * ↑↓移動・ドラッグ並べ替えの両方から共用する。
 * orderedUids に含まれない行（想定外）は元の readingOrder を残し、末尾に回す。
 */
function applyReadingOrder(
  blocks: TextBlock[],
  orderedUids: string[]
): { textBlocks: TextBlock[]; fullText: string } {
  const orderMap = new Map(orderedUids.map((uid, i) => [uid, i + 1]))
  const textBlocks = blocks.map((b) => {
    const next = b.uid ? orderMap.get(b.uid) : undefined
    return next !== undefined ? { ...b, readingOrder: next } : b
  })
  const fullText = [...textBlocks]
    .sort((a, b) => a.readingOrder - b.readingOrder)
    .filter((b) => b.text)
    .map((b) => b.text)
    .join('\n')
  return { textBlocks, fullText }
}

/** 読み順Undo履歴：1ページあたりのスナップショット上限 */
const REORDER_UNDO_LIMIT = 50

/** uid配列が完全一致（長さ＋全要素）かどうか */
function sameUidOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((u, i) => u === b[i])
}

/** readingOrder 昇順の uid 配列（Undoスナップショット用） */
function currentUidOrder(blocks: TextBlock[]): string[] {
  return [...blocks]
    .sort((a, b) => a.readingOrder - b.readingOrder)
    .map((b) => b.uid as string)
}


export default function App() {
  const { lang, toggleLanguage } = useI18n()
  const { isReady, jobState, processImage, resetState } = useOCRWorker()
  const { processedImages, isLoading: isLoadingFiles, error: fileError, processFiles, clearImages, clearError, fileLoadingState, restoreImages } = useFileProcessor()
  const { runs: historyRuns, saveRun, clearResults } = useResultCache()

  const [sessionResults, setSessionResults] = useState<OCRResult[]>([])
  const [selectedResultIndex, setSelectedResultIndex] = useState(0)
  const [selectedBlock, setSelectedBlock] = useState<TextBlock | null>(null)
  const [selectedPageBlock, setSelectedPageBlock] = useState<PageBlock | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isReadyToProcess, setIsReadyToProcess] = useState(false)
  // 認識に失敗したページ番号（1始まり）。処理完了後の通知バナー表示用
  const [failedPageNumbers, setFailedPageNumbers] = useState<number[]>([])
  // 連続失敗により処理を中断したか（診断バナーに追記するため）
  const [stoppedEarly, setStoppedEarly] = useState(false)
  const [pendingImageIndex, setPendingImageIndex] = useState(0)
  // 組み方向（認識の読み順とPDF書き出しの両方に反映）
  const [orientation, setOrientation] = useState<Orientation>('auto')

  // 画像パネルとテキストパネルの幅調整（仕切りドラッグ）
  const resultMainRef = useRef<HTMLDivElement>(null)
  const userResizedRef = useRef(false) // ユーザーが手動で幅を変えたか（変えたら自動調整しない）
  const [rightWidth, setRightWidth] = useState(480)
  const [isDraggingDivider, setIsDraggingDivider] = useState(false)
  const startDividerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = resultMainRef.current
    if (!container) return
    userResizedRef.current = true
    setIsDraggingDivider(true)
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const w = Math.max(280, Math.min(rect.width - 320, rect.right - ev.clientX))
      setRightWidth(w)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setIsDraggingDivider(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // 読み順変更のUndo履歴（ページ＝OCRResult.idごとに独立したスタック。
  // 各要素は「変更前の readingOrder 昇順 uid 配列」のスナップショット）
  const reorderUndoStacksRef = useRef<Map<string, string[][]>>(new Map())
  // refの増減だけでは再レンダリングされないため、履歴が変わるたびにカウンタを進めて
  // canUndoReorder（ボタンの活性状態）を再計算させる
  const [, bumpUndoTick] = useState(0)

  /**
   * 並べ替え適用「直前」の順序をスタックにpushする。
   * setSessionResults の更新関数内から呼ばれるため、React StrictMode（開発時）の
   * 二重呼び出し対策として「スタック先頭が今回のスナップショットと同一ならpushしない」
   * ガードで冪等にしてある。
   */
  const pushReorderSnapshot = useCallback((resultId: string, snapshot: string[]) => {
    const map = reorderUndoStacksRef.current
    const stack = map.get(resultId) ?? []
    const top = stack[stack.length - 1]
    if (top && sameUidOrder(top, snapshot)) return // StrictModeの二重push防止
    stack.push(snapshot)
    if (stack.length > REORDER_UNDO_LIMIT) stack.shift() // 古い方から捨てる
    map.set(resultId, stack)
  }, [])

  // 一時保存（校正中の作業の自動保存・復元）
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [draftToRestore, setDraftToRestore] = useState<DBRunEntry | null>(null)
  const fullUrlCacheRef = useRef<Map<number, string>>(new Map())
  const draftTimerRef = useRef<number | null>(null)
  const savedImagesRunRef = useRef<string | null>(null) // 画像を保存済みの runId（実行ごとに1回だけ保存）

  // pending 状態での ImageViewer 表示用（全解像度 DataUrl）
  const pendingDataUrls = useMemo(
    () => processedImages.map((img) => imageDataToDataUrl(img.imageData)),
    [processedImages]
  )

  // 結果表示時、ユーザーが未調整なら画像とテキストをほぼ半々の幅に初期化（画像が読みやすい）
  useEffect(() => {
    if (sessionResults.length === 0 || userResizedRef.current) return
    const el = resultMainRef.current
    if (!el) return
    const total = el.clientWidth
    if (total > 0) setRightWidth(Math.round((total - 10) * 3 / 5)) // 左2:右3
  }, [sessionResults.length])

  // 起動時：前回の校正作業（ドラフト）があれば復元バナーを出す
  useEffect(() => {
    getDraft().then((d) => {
      if (d && d.files && d.files.length > 0) setDraftToRestore(d)
    }).catch(() => {})
  }, [])

  // フル画像のdataURLはOCR後不変なのでキャッシュ（編集のたびに再エンコードしない）
  useEffect(() => { fullUrlCacheRef.current = new Map() }, [processedImages])
  const getFullUrl = useCallback((i: number, img: ProcessedImage): string => {
    const cached = fullUrlCacheRef.current.get(i)
    if (cached) return cached
    const url = imageDataToDataUrl(img.imageData)
    fullUrlCacheRef.current.set(i, url)
    return url
  }, [])

  // 校正内容を自動で一時保存（編集のたびにデバウンス保存）
  // 最適化：フル画像は実行ごとに1回だけ保存し、以降の保存はテキストのみ更新。
  useEffect(() => {
    if (isProcessing || sessionResults.length === 0 || !currentRunId) return
    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current)
    const runId = currentRunId
    draftTimerRef.current = window.setTimeout(async () => {
      const n = Math.min(sessionResults.length, processedImages.length)

      // 画像はこの runId でまだ保存していなければ1回だけ保存
      if (savedImagesRunRef.current !== runId) {
        const urls = Array.from({ length: n }, (_, i) => getFullUrl(i, processedImages[i]))
        await saveDraftImages(runId, urls).catch(() => {})
        savedImagesRunRef.current = runId
      }

      // テキスト側は毎回更新（軽量）
      const files = sessionResults.slice(0, n).map((r, i) => ({
        fileName: r.fileName,
        imageDataUrl: r.imageDataUrl,
        pageIndex: processedImages[i].pageIndex,
        textBlocks: r.textBlocks,
        fullText: r.fullText,
        processingTimeMs: r.processingTimeMs,
      }))
      await saveDraftText({ id: runId, files, createdAt: Date.now() }).catch(() => {})
    }, 800)
    return () => { if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current) }
  }, [sessionResults, isProcessing, currentRunId, processedImages, getFullUrl])

  // ドラフトから作業を復元（フル画像を復号して processedImages も再構築）
  const handleRestoreDraft = useCallback(async () => {
    const d = draftToRestore
    if (!d) return
    const imgs: ProcessedImage[] = []
    const results: OCRResult[] = []
    for (let i = 0; i < d.files.length; i++) {
      const f = d.files[i]
      const src = f.imageFullDataUrl ?? f.imageDataUrl
      const imageData = await dataUrlToImageData(src)
      imgs.push({ fileName: f.fileName, pageIndex: f.pageIndex, imageData, thumbnailDataUrl: f.imageDataUrl })
      // アプリ境界②：IndexedDB（ドラフト）復元直後に uid を保証する（uid無しの旧データにも付与）
      results.push(ensureBlockUids({
        id: `${d.id}-${i}`,
        fileName: f.fileName,
        imageDataUrl: f.imageDataUrl,
        textBlocks: f.textBlocks,
        fullText: f.fullText,
        processingTimeMs: f.processingTimeMs,
        createdAt: d.createdAt,
      }))
    }
    restoreImages(imgs)
    setSessionResults(results)
    reorderUndoStacksRef.current.clear() // 古いresult.idのUndo履歴を破棄
    setSelectedResultIndex(0)
    setFailedPageNumbers([])
    setStoppedEarly(false)
    setCurrentRunId(d.id)
    savedImagesRunRef.current = d.id // 画像は既にDBにあるので再保存しない
    setDraftToRestore(null)
  }, [draftToRestore, restoreImages])

  const handleDismissDraft = useCallback(async () => {
    setDraftToRestore(null)
    await clearDraft().catch(() => {})
  }, [])

  // processedImages が差し替わったらインデックスをリセット
  useEffect(() => { setPendingImageIndex(0) }, [processedImages])

  const currentResult = sessionResults[selectedResultIndex] ?? null

  // 各ページの要確認件数（サムネイル・ページ選択に⚠️マークを出すため）
  const pageWarnCounts = useMemo(
    () => sessionResults.map((r) => countPageWarnings(r)),
    [sessionResults]
  )

  // 認識失敗バナーに出す診断用エラー詳細（最初に失敗した1件のメッセージのみ表示）
  const firstFailedErrorMessage = useMemo(
    () => sessionResults.find((r) => r.error && r.errorMessage)?.errorMessage ?? null,
    [sessionResults]
  )

  const selectedPageBlockText = useMemo(() => {
    if (!selectedPageBlock || !currentResult) return null
    const cx = (b: TextBlock) => b.x + b.width / 2
    const cy = (b: TextBlock) => b.y + b.height / 2
    return currentResult.textBlocks
      .filter(b =>
        cx(b) >= selectedPageBlock.x && cx(b) <= selectedPageBlock.x + selectedPageBlock.width &&
        cy(b) >= selectedPageBlock.y && cy(b) <= selectedPageBlock.y + selectedPageBlock.height
      )
      .sort((a, b) => a.readingOrder - b.readingOrder)
      .map(b => b.text)
      .join('\n')
  }, [selectedPageBlock, currentResult])

  const handleFilesSelected = useCallback(async (files: File[]) => {
    await processFiles(files)
  }, [processFiles])

  // Ctrl+V / Cmd+V でクリップボードの画像を貼り付け（アップロード画面表示中のみ）
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (sessionResults.length > 0 || isLoadingFiles || isProcessing) return
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) handleFilesSelected(files)
    }
    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [sessionResults.length, isLoadingFiles, isProcessing, handleFilesSelected])

  const handleSampleLoad = useCallback(async () => {
    const res = await fetch('/kumonoito.png')
    const blob = await res.blob()
    const file = new File([blob], 'kumonoito.png', { type: 'image/png' })
    await processFiles([file])
  }, [processFiles])

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            const ext = type.split('/')[1] || 'png'
            files.push(new File([blob], `clipboard.${ext}`, { type }))
          }
        }
      }
      if (files.length > 0) await processFiles(files)
    } catch {
      // permission denied or no image in clipboard — ignore silently
    }
  }, [processFiles])

  // 「認識を開始」が押されたら OCR 実行
  useEffect(() => {
    if (!isReadyToProcess || processedImages.length === 0 || isProcessing) return

    const runOCR = async () => {
      setIsProcessing(true)
      setSessionResults([])
      reorderUndoStacksRef.current.clear() // 古いresult.idのUndo履歴を破棄
      setSelectedResultIndex(0)
      setFailedPageNumbers([])
      setStoppedEarly(false)
      resetState()

      const runId = crypto.randomUUID()
      setCurrentRunId(runId)
      const runCreatedAt = Date.now()
      // 不変条件: sessionResults[i] は常に processedImages[i] に対応する。
      // 失敗ページはスキップせず、空のエラープレースホルダを同じ添字に入れる。
      const sessionResultsAccum: OCRResult[] = []
      const failedPages: number[] = []
      // 先頭からの連続失敗回数。iPadでの初期化失敗などは毎ページ同じエラーになるため、
      // 18ページ全部待たなくても早期に気づけるよう、一定回数連続したら処理を打ち切る。
      let consecutiveFailures = 0
      const CONSECUTIVE_FAILURE_LIMIT = 3

      for (let i = 0; i < processedImages.length; i++) {
        const image = processedImages[i]
        try {
          const result = await processImage(image, i, processedImages.length, orientation)
          sessionResultsAccum.push(result)
          consecutiveFailures = 0
        } catch (err) {
          console.error(`OCR failed for ${image.fileName}:`, err)
          failedPages.push(i + 1)
          consecutiveFailures++
          sessionResultsAccum.push({
            id: `${runId}-${i}`,
            fileName: image.pageIndex ? `${image.fileName} (p.${image.pageIndex})` : image.fileName,
            // 失敗ページのプレビューはサムネイル（幅200px）だと読めないため、フル解像度画像を使う
            imageDataUrl: getFullUrl(i, image),
            textBlocks: [],
            fullText: '',
            processingTimeMs: 0,
            createdAt: runCreatedAt,
            error: true,
            errorMessage: (err as Error).message,
          })
        }
        setSessionResults([...sessionResultsAccum])
        setSelectedResultIndex(sessionResultsAccum.length - 1)
        // 失敗のたびにバナーを更新する（処理完了を待たず、1ページ目の失敗時点で気づけるように）
        setFailedPageNumbers([...failedPages])

        // 同じエラーが連続したら、残りページは処理せず中断する
        if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
          setStoppedEarly(true)
          for (let j = i + 1; j < processedImages.length; j++) {
            const skipped = processedImages[j]
            failedPages.push(j + 1)
            sessionResultsAccum.push({
              id: `${runId}-${j}`,
              fileName: skipped.pageIndex ? `${skipped.fileName} (p.${skipped.pageIndex})` : skipped.fileName,
              imageDataUrl: getFullUrl(j, skipped),
              textBlocks: [],
              fullText: '',
              processingTimeMs: 0,
              createdAt: runCreatedAt,
              error: true,
              errorMessage: '（連続失敗のため中断）',
            })
          }
          setSessionResults([...sessionResultsAccum])
          setFailedPageNumbers([...failedPages])
          break
        }
      }

      // 成功ページが1つでもあれば履歴に保存。ページ順・ページ数を保つため、
      // 失敗ページも空テキストのまま同じ順序で含める。
      if (sessionResultsAccum.some((r) => !r.error)) {
        const runEntry: DBRunEntry = {
          id: runId,
          files: sessionResultsAccum.map((result, i) => ({
            fileName: result.fileName,
            imageDataUrl: processedImages[i].thumbnailDataUrl,
            textBlocks: result.textBlocks,
            fullText: result.fullText,
            processingTimeMs: result.processingTimeMs,
          })),
          createdAt: runCreatedAt,
        }
        await saveRun(runEntry)
      }

      setFailedPageNumbers(failedPages)
      setIsProcessing(false)
      setIsReadyToProcess(false)
    }

    runOCR()
  }, [isReadyToProcess]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    clearImages()
    setSessionResults([])
    reorderUndoStacksRef.current.clear()
    setSelectedResultIndex(0)
    setSelectedBlock(null)
    setSelectedPageBlock(null)
    resetState()
    setIsProcessing(false)
    setIsReadyToProcess(false)
    setFailedPageNumbers([])
    setStoppedEarly(false)
    setPendingImageIndex(0)
    setCurrentRunId(null)
    savedImagesRunRef.current = null
    userResizedRef.current = false
    clearDraft().catch(() => {})
  }


  // 認識テキストの手修正：選択中ページの該当ブロックを書き換え、fullText を再構成
  // （textBlocks を更新するので、透明テキストPDF・ePub・Word・コピーすべてに反映される）
  const handleEditBlock = useCallback((target: TextBlock, newText: string) => {
    setSessionResults(prev => prev.map((r, i) => {
      if (i !== selectedResultIndex) return r
      const textBlocks = r.textBlocks.map(b =>
        b.uid === target.uid ? { ...b, text: newText } : b
      )
      const fullText = [...textBlocks].sort((x, y) => x.readingOrder - y.readingOrder)
        .filter(b => b.text).map(b => b.text).join('\n')
      return { ...r, textBlocks, fullText }
    }))
    setSelectedBlock(prev =>
      prev && prev.uid === target.uid ? { ...prev, text: newText } : prev
    )
  }, [selectedResultIndex])

  // 読み順の並べ替え（ドラッグ・複数行まとめ移動）。渡された uid 順に readingOrder を 1..n で
  // 振り直し、fullText を再構成する。textBlocks を更新するので PDF・ePub・Word・コピーすべてに反映される。
  const handleReorderBlocks = useCallback((orderedUids: string[]) => {
    setSessionResults(prev => prev.map((r, i) => {
      if (i !== selectedResultIndex) return r
      const before = currentUidOrder(r.textBlocks)
      if (sameUidOrder(before, orderedUids)) return r // 順序が変わらない呼び出しはpushも適用もしない
      pushReorderSnapshot(r.id, before) // Undo用に変更前の順序を保存
      const { textBlocks, fullText } = applyReadingOrder(r.textBlocks, orderedUids)
      return { ...r, textBlocks, fullText }
    }))
    bumpUndoTick(t => t + 1)
  }, [selectedResultIndex, pushReorderSnapshot])

  // 認識行の読み順を1つ入れ替え（↑↓・単一行）。読み順配列を作り、隣と入れ替えて振り直す。
  const handleMoveBlock = useCallback((target: TextBlock, dir: 'up' | 'down') => {
    setSessionResults(prev => prev.map((r, i) => {
      if (i !== selectedResultIndex) return r
      const sorted = [...r.textBlocks].sort((a, b) => a.readingOrder - b.readingOrder)
      const idx = sorted.findIndex(b => b.uid === target.uid)
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return r
      const before = sorted.map(b => b.uid!) // 変更前の順序（Undoスナップショット）
      const orderedUids = [...before]
      ;[orderedUids[idx], orderedUids[swapIdx]] = [orderedUids[swapIdx], orderedUids[idx]]
      pushReorderSnapshot(r.id, before)
      const { textBlocks, fullText } = applyReadingOrder(r.textBlocks, orderedUids)
      return { ...r, textBlocks, fullText }
    }))
    bumpUndoTick(t => t + 1)
  }, [selectedResultIndex, pushReorderSnapshot])

  // 読み順変更のUndo：現在ページのスタックから1つ戻す（テキスト内容の編集は対象外）
  const handleUndoReorder = useCallback(() => {
    const result = sessionResults[selectedResultIndex]
    if (!result) return
    const stack = reorderUndoStacksRef.current.get(result.id)
    if (!stack || stack.length === 0) return
    // pop はイベントハンドラ内（更新関数の外）なので StrictMode でも1回だけ実行される
    const snapshot = stack.pop()!
    setSessionResults(prev => prev.map((r, i) => {
      if (i !== selectedResultIndex) return r
      const { textBlocks, fullText } = applyReadingOrder(r.textBlocks, snapshot)
      return { ...r, textBlocks, fullText } // Undo適用時はpushしない
    }))
    bumpUndoTick(t => t + 1)
  }, [sessionResults, selectedResultIndex])

  // 現在ページにUndoできる履歴があるか（bumpUndoTickによる再レンダリングで同期する）
  const canUndoReorder =
    !!currentResult &&
    (reorderUndoStacksRef.current.get(currentResult.id)?.length ?? 0) > 0

  // Ctrl+Z / Cmd+Z で読み順Undo（編集可能な結果が表示されている間のみ）。
  // テキスト欄（textarea/input/contenteditable）内やIME変換中は既定動作
  // （テキスト欄のネイティブUndo）に譲る。Redoは対象外。
  useEffect(() => {
    if (!currentResult || currentResult.error) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
      if (e.isComposing) return
      const el = e.target instanceof Element ? e.target : null
      if (el && el.closest('textarea, input, [contenteditable]')) return
      e.preventDefault()
      handleUndoReorder()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [currentResult, handleUndoReorder])

  // 履歴の run には縮小サムネイル（imageDataUrl）しか保存されておらず、
  // フル解像度画像は無い（DBRunFile.imageFullDataUrl はドラフト専用）。
  // そのため processedImages は復元せずクリアし、テキストのみの表示に切り替える。
  // これにより「現在の画像 × 過去のテキスト」の混在を防ぎ、PDF書き出しは無効化する。
  const handleHistorySelect = (run: DBRunEntry) => {
    // アプリ境界②：IndexedDB（履歴）復元直後に uid を保証する（uid無しの旧データにも付与）
    const restoredResults: OCRResult[] = run.files.map((file, i) => ensureBlockUids({
      id: `${run.id}-${i}`,
      fileName: file.fileName,
      imageDataUrl: file.imageDataUrl,
      textBlocks: file.textBlocks,
      fullText: file.fullText,
      processingTimeMs: file.processingTimeMs,
      createdAt: run.createdAt,
    }))
    clearImages() // 現在読み込み中の画像を破棄（過去テキストと混ざらないように）
    setSessionResults(restoredResults)
    reorderUndoStacksRef.current.clear() // 古いresult.idのUndo履歴を破棄
    setSelectedResultIndex(0)
    setSelectedBlock(null)
    setSelectedPageBlock(null)
    setCurrentRunId(null) // 履歴表示中はドラフト自動保存しない
    setFailedPageNumbers([])
    setStoppedEarly(false)
    setShowHistory(false)
  }

  const isModelLoading = jobState.status === 'loading_model'
  const isWorking = isLoadingFiles || isProcessing
  const hasResults = sessionResults.length > 0
  const hasPendingImages = processedImages.length > 0 && !isWorking && !hasResults
  // 履歴からの表示：結果はあるが画像が無い状態（PDFは書き出せず、テキストのみ利用可）
  const textOnlyHistory = hasResults && processedImages.length === 0
  // サイドバー・ページナビの項目。通常は画像から、履歴表示時は結果テキストから作る。
  const pageItems = processedImages.length > 0
    ? processedImages.map((img) => ({ fileName: img.fileName, pageIndex: img.pageIndex as number | undefined, thumb: img.thumbnailDataUrl }))
    : sessionResults.map((r) => ({ fileName: r.fileName, pageIndex: undefined as number | undefined, thumb: r.imageDataUrl }))
  // 表紙（ランディング）：処理中でも結果でもない空状態
  const isLanding = !hasResults && !isWorking && !isModelLoading && !hasPendingImages

  // 設定・履歴モーダルは表紙でも通常画面でも共通で出す
  const modals = (
    <>
      {showHistory && (
        <HistoryPanel
          runs={historyRuns}
          onSelect={handleHistorySelect}
          onClear={clearResults}
          onClose={() => setShowHistory(false)}
          lang={lang}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} lang={lang} />
      )}
    </>
  )

  if (isLanding) {
    return (
      <div className="app">
        {fileError && (
          <div className="draft-banner ocr-fail-banner file-error-banner lens-draft-banner">
            <span className="draft-banner-text">{fileError}</span>
            <div className="draft-banner-actions">
              <button className="btn btn-secondary" onClick={clearError}>
                {lang === 'ja' ? '閉じる' : 'Dismiss'}
              </button>
            </div>
          </div>
        )}
        {draftToRestore && (
          <div className="draft-banner lens-draft-banner">
            <span className="draft-banner-text">
              {lang === 'ja'
                ? `前回の校正作業が残っています（${draftToRestore.files.length}ページ・${new Date(draftToRestore.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 保存）`
                : `Unsaved proofreading from last time (${draftToRestore.files.length} page(s))`}
            </span>
            <div className="draft-banner-actions">
              <button className="btn btn-primary" onClick={handleRestoreDraft}>
                {lang === 'ja' ? '復元する' : 'Restore'}
              </button>
              <button className="btn btn-secondary" onClick={handleDismissDraft}>
                {lang === 'ja' ? '破棄' : 'Discard'}
              </button>
            </div>
          </div>
        )}
        <WelcomeScreen
          lang={lang}
          onFilesSelected={handleFilesSelected}
          onToggleLanguage={toggleLanguage}
          onOpenSettings={() => setShowSettings(true)}
          onOpenHistory={() => setShowHistory(true)}
          onPaste={handlePasteFromClipboard}
          onSampleLoad={handleSampleLoad}
          disabled={isWorking}
        />
        {modals}
      </div>
    )
  }

  return (
    <div className="app">
      <Header
        lang={lang}
        onToggleLanguage={toggleLanguage}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        onLogoClick={handleClear}
      />

      <main className="main">
        {fileError && (
          <div className="draft-banner ocr-fail-banner file-error-banner">
            <span className="draft-banner-text">{fileError}</span>
            <div className="draft-banner-actions">
              <button className="btn btn-secondary" onClick={clearError}>
                {lang === 'ja' ? '閉じる' : 'Dismiss'}
              </button>
            </div>
          </div>
        )}
        {draftToRestore && !hasResults && !isWorking && (
          <div className="draft-banner">
            <span className="draft-banner-text">
              {lang === 'ja'
                ? `前回の校正作業が残っています（${draftToRestore.files.length}ページ・${new Date(draftToRestore.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 保存）`
                : `Unsaved proofreading from last time (${draftToRestore.files.length} page(s))`}
            </span>
            <div className="draft-banner-actions">
              <button className="btn btn-primary" onClick={handleRestoreDraft}>
                {lang === 'ja' ? '復元する' : 'Restore'}
              </button>
              <button className="btn btn-secondary" onClick={handleDismissDraft}>
                {lang === 'ja' ? '破棄' : 'Discard'}
              </button>
            </div>
          </div>
        )}
        {hasPendingImages && (
          <section className="result-section">
            {/* 左サイドバー */}
            {processedImages.length > 1 && (
              <div className="result-sidebar">
                {processedImages.map((img, i) => (
                  <button
                    key={i}
                    className={`result-sidebar-item ${i === pendingImageIndex ? 'active' : ''}`}
                    onClick={() => setPendingImageIndex(i)}
                    title={img.pageIndex ? `${img.fileName} (p.${img.pageIndex})` : img.fileName}
                  >
                    <img src={img.thumbnailDataUrl} alt={img.fileName} />
                    <span className="result-sidebar-label">
                      {img.pageIndex ? `${img.fileName} (p.${img.pageIndex})` : img.fileName}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="result-content">
              {/* ページナビゲーション */}
              {processedImages.length > 1 && (
                <div className="result-page-nav">
                  <button
                    className="btn-nav"
                    onClick={() => setPendingImageIndex(prev => prev - 1)}
                    disabled={pendingImageIndex === 0}
                    title={lang === 'ja' ? '前のファイル' : 'Previous file'}
                  >←</button>
                  <select
                    className="result-page-select"
                    value={pendingImageIndex}
                    onChange={(e) => setPendingImageIndex(Number(e.target.value))}
                  >
                    {processedImages.map((img, i) => (
                      <option key={i} value={i}>
                        {i + 1} / {processedImages.length}
                        {img.pageIndex ? `${img.fileName} (p.${img.pageIndex})` : img.fileName}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-nav"
                    onClick={() => setPendingImageIndex(prev => prev + 1)}
                    disabled={pendingImageIndex === processedImages.length - 1}
                    title={lang === 'ja' ? '次のファイル' : 'Next file'}
                  >→</button>
                </div>
              )}

              <div className="result-main">
                <div className="result-left">
                  <div className="pre-ocr-controls">
                    <label className="result-actions-option">
                      {lang === 'ja' ? '組み方向：' : 'Writing mode: '}
                      <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
                        <option value="auto">{lang === 'ja' ? '自動判定' : 'Auto'}</option>
                        <option value="vertical">{lang === 'ja' ? '縦書き' : 'Vertical'}</option>
                        <option value="horizontal">{lang === 'ja' ? '横書き' : 'Horizontal'}</option>
                      </select>
                    </label>
                    <button className="btn btn-primary btn-above-viewer" onClick={() => setIsReadyToProcess(true)}>
                      {lang === 'ja' ? '認識を開始' : 'Start Recognition'}
                    </button>
                  </div>
                  <ImageViewer
                    imageDataUrl={pendingDataUrls[pendingImageIndex] ?? ''}
                    textBlocks={[]}
                    selectedBlock={null}
                    onBlockSelect={() => {}}
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {(isLoadingFiles || isModelLoading) && (
          <div className="processing-section">
            {isLoadingFiles && fileLoadingState && (
              <div className="file-loading-status">
                <div className="file-loading-spinner" />
                <span className="file-loading-message">
                  {fileLoadingState.currentPage != null && fileLoadingState.totalPages != null
                    ? lang === 'ja'
                      ? `${fileLoadingState.fileName} をレンダリング中... (${fileLoadingState.currentPage} / ${fileLoadingState.totalPages} ページ)`
                      : `Rendering ${fileLoadingState.fileName}... (page ${fileLoadingState.currentPage} / ${fileLoadingState.totalPages})`
                    : lang === 'ja'
                      ? `${fileLoadingState.fileName} を読み込み中...`
                      : `Loading ${fileLoadingState.fileName}...`}
                </span>
              </div>
            )}
            <ProgressBar jobState={jobState} lang={lang} />
            {!isReady && !isModelLoading && (
              <p className="model-loading-note">
                {lang === 'ja'
                  ? '初回起動時はモデルのダウンロードに時間がかかります（数分程度）。次回以降はキャッシュから高速起動します。'
                  : 'First run requires model download (may take a few minutes). Subsequent runs will use the cached model.'}
              </p>
            )}
          </div>
        )}

        {(hasResults || isProcessing) && (processedImages.length > 0 || textOnlyHistory) && (
          <section className="result-section">
            {/* 左サイドバー: 全ファイル一覧（未完了・失敗も含む） */}
            {pageItems.length > 1 && (
              <div className="result-sidebar">
                {pageItems.map((item, i) => {
                  const result = sessionResults[i]
                  const isInProgress = !result && isProcessing && i === sessionResults.length
                  const isPending = !result && !isInProgress
                  const isError = !!result?.error
                  const warnCount = pageWarnCounts[i] || 0
                  const warnTitle = warnCount > 0
                    ? (lang === 'ja' ? `　要確認 ${warnCount} 件` : ` · ${warnCount} to review`)
                    : ''
                  const errorTitle = isError ? (lang === 'ja' ? '　認識に失敗（画像のみ）' : ' · recognition failed (image only)') : ''
                  const folio = result?.folio
                  const fileLabel = item.pageIndex ? `${item.fileName} (p.${item.pageIndex})` : item.fileName
                  const folioTitle = folio ? (lang === 'ja' ? `　書籍ページ ${folio}` : ` · book p.${folio}`) : ''
                  return (
                    <button
                      key={i}
                      className={`result-sidebar-item ${result && i === selectedResultIndex ? 'active' : ''} ${isPending || isInProgress ? 'sidebar-pending' : ''}`}
                      onClick={() => { if (result) { setSelectedResultIndex(i); setSelectedBlock(null) } }}
                      disabled={!result}
                      title={`${i + 1}　${fileLabel}${folioTitle}${errorTitle}${warnTitle}`}
                    >
                      <div className="result-sidebar-thumb-wrap">
                        <img src={result ? result.imageDataUrl : item.thumb} alt={item.fileName} />
                        {isInProgress && <div className="sidebar-item-spinner" />}
                        {isError && (
                          <span className="sidebar-error-badge" title={errorTitle.trim()}>
                            ❌
                          </span>
                        )}
                        {warnCount > 0 && (
                          <span className="sidebar-warn-badge" title={warnTitle.trim()}>
                            ⚠️{warnCount}
                          </span>
                        )}
                      </div>
                      <span className="result-sidebar-label">
                        <span className="sidebar-page-no">{i + 1}</span>
                        {folio && (
                          <span className="sidebar-folio" title={lang === 'ja' ? `書籍の印刷ページ番号（OCR推定）` : 'Printed book page (OCR estimate)'}>
                            📖{folio}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* メインコンテンツ */}
            <div className="result-content">
              {/* OCR処理中プログレスバー */}
              {isProcessing && (
                <div className="result-progress-inline">
                  <ProgressBar jobState={jobState} lang={lang} />
                </div>
              )}

              {/* 認識失敗ページの通知（失敗ページは画像のみで書き出される）。
                  処理完了を待たず、失敗が出た時点で表示する（iPad等での初期化失敗に素早く気づけるように） */}
              {failedPageNumbers.length > 0 && (
                <div className="draft-banner ocr-fail-banner">
                  <span className="draft-banner-text">
                    {lang === 'ja'
                      ? `${failedPageNumbers.join('、')}ページ目の認識に失敗しました。該当ページは画像のみで書き出されます。${stoppedEarly ? '同じエラーが続いたため処理を中断しました。' : ''}`
                      : `Recognition failed for page(s) ${failedPageNumbers.join(', ')}. Those pages are exported as image-only.${stoppedEarly ? ' Processing was stopped after repeated failures.' : ''}`}
                  </span>
                  {!isProcessing && (
                    <div className="draft-banner-actions">
                      <button className="btn btn-secondary" onClick={() => setFailedPageNumbers([])}>
                        {lang === 'ja' ? '閉じる' : 'Dismiss'}
                      </button>
                    </div>
                  )}
                  {/* 診断用：最初に失敗した1件のエラー詳細（スクショに写らないため画面下に出す） */}
                  {firstFailedErrorMessage && (
                    <div className="result-error-detail">{firstFailedErrorMessage}</div>
                  )}
                </div>
              )}

              {/* 履歴（テキストのみ）表示の注意書き */}
              {textOnlyHistory && (
                <div className="draft-banner ocr-history-banner">
                  <span className="draft-banner-text">
                    {lang === 'ja'
                      ? '履歴からはテキストのみ利用できます（画像は保存されていないため、PDFは書き出せません）。'
                      : 'Only text is available from history (images are not stored, so PDF export is disabled).'}
                  </span>
                </div>
              )}

              {/* ページナビゲーション */}
              <div className="result-page-nav">
                <button
                  className="btn-nav"
                  onClick={() => { setSelectedResultIndex(prev => prev - 1); setSelectedBlock(null); setSelectedPageBlock(null) }}
                  disabled={selectedResultIndex === 0}
                  title={lang === 'ja' ? '前のファイル' : 'Previous file'}
                >
                  ←
                </button>
                <select
                  className="result-page-select"
                  value={selectedResultIndex}
                  onChange={(e) => {
                    setSelectedResultIndex(Number(e.target.value))
                    setSelectedBlock(null)
                    setSelectedPageBlock(null)
                  }}
                >
                  {pageItems.map((item, i) => {
                    const label = item.pageIndex ? `${item.fileName} (p.${item.pageIndex})` : item.fileName
                    const warnCount = pageWarnCounts[i] || 0
                    const warnMark = warnCount > 0 ? `　⚠️${warnCount}` : ''
                    const errorMark = sessionResults[i]?.error ? (lang === 'ja' ? '　❌認識失敗' : '　❌failed') : ''
                    const folio = sessionResults[i]?.folio
                    const folioMark = folio ? `　📖${folio}` : ''
                    return (
                      <option key={i} value={i} disabled={i >= sessionResults.length}>
                        {i + 1} / {pageItems.length}　{label}{folioMark}{errorMark}{warnMark}
                      </option>
                    )
                  })}
                </select>
                <button
                  className="btn-nav"
                  onClick={() => { setSelectedResultIndex(prev => prev + 1); setSelectedBlock(null); setSelectedPageBlock(null) }}
                  disabled={selectedResultIndex >= sessionResults.length - 1}
                  title={lang === 'ja' ? '次のファイル' : 'Next file'}
                >
                  →
                </button>
              </div>

              {/* 選択中ページが失敗ページの場合、スクロールしなくても見える位置にエラー詳細を出す */}
              {currentResult?.error && currentResult.errorMessage && (
                <div className="result-error-detail">{currentResult.errorMessage}</div>
              )}

              <div
                className="result-main resizable"
                ref={resultMainRef}
                style={{ '--right-w': `${rightWidth}px` } as React.CSSProperties}
              >
                <div className="result-left">
                  {!isProcessing && (
                    <button className="btn btn-secondary btn-above-viewer" onClick={handleClear}>
                      {lang === 'ja' ? '新しいファイルを処理' : 'Process New Files'}
                    </button>
                  )}
                  {currentResult && !textOnlyHistory && (
                    <ImageViewer
                      imageDataUrl={currentResult.imageDataUrl}
                      textBlocks={currentResult.textBlocks}
                      selectedBlock={selectedBlock}
                      onBlockSelect={(block) => { setSelectedBlock(block); setSelectedPageBlock(null) }}
                      pageBlocks={currentResult.pageBlocks}
                      selectedPageBlock={selectedPageBlock}
                      onPageBlockSelect={(block) => { setSelectedPageBlock(block); setSelectedBlock(null) }}
                    />
                  )}
                  {textOnlyHistory && (
                    <div className="history-image-placeholder">
                      {lang === 'ja'
                        ? '履歴の項目には画像が保存されていません。テキストのみ表示しています。'
                        : 'No image is stored for history items. Showing text only.'}
                    </div>
                  )}
                </div>

                <div
                  className={`result-divider${isDraggingDivider ? ' dragging' : ''}`}
                  onMouseDown={startDividerDrag}
                  role="separator"
                  aria-orientation="vertical"
                  title={lang === 'ja' ? 'ドラッグで幅を調整' : 'Drag to resize'}
                />

                <div className="result-right">
                  <ResultPanel result={currentResult} selectedBlock={selectedBlock} selectedPageBlockText={selectedPageBlockText} onEditBlock={handleEditBlock} onMoveBlock={handleMoveBlock} onReorderBlocks={handleReorderBlocks} onUndoReorder={handleUndoReorder} canUndoReorder={canUndoReorder} lang={lang} />
                  <ResultActions results={sessionResults} currentResult={currentResult} processedImages={processedImages} orientation={orientation} pdfAvailable={!textOnlyHistory} lang={lang} />
                </div>
              </div>

            </div>
          </section>
        )}
      </main>

      <Footer lang={lang} />

      {modals}
    </div>
  )
}
