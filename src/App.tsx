import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { OCRResult, TextBlock, PageBlock } from './types/ocr'
import type { DBRunEntry } from './types/db'
import { useI18n } from './hooks/useI18n'
import { useOCRWorker } from './hooks/useOCRWorker'
import { useFileProcessor } from './hooks/useFileProcessor'
import { useResultCache } from './hooks/useResultCache'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { FileDropZone } from './components/upload/FileDropZone'
import { DirectoryPicker } from './components/upload/DirectoryPicker'
import { ProgressBar } from './components/progress/ProgressBar'
import { ImageViewer } from './components/viewer/ImageViewer'
import { ResultPanel } from './components/results/ResultPanel'
import { ResultActions } from './components/results/ResultActions'
import { HistoryPanel } from './components/results/HistoryPanel'
import { SettingsModal } from './components/settings/SettingsModal'
import { imageDataToDataUrl } from './utils/imageLoader'
import { getDraft, saveDraftText, saveDraftImages, clearDraft } from './utils/db'
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


export default function App() {
  const { lang, toggleLanguage } = useI18n()
  const { isReady, jobState, processImage, resetState } = useOCRWorker()
  const { processedImages, isLoading: isLoadingFiles, processFiles, clearImages, fileLoadingState, restoreImages } = useFileProcessor()
  const { runs: historyRuns, saveRun, clearResults } = useResultCache()

  const [sessionResults, setSessionResults] = useState<OCRResult[]>([])
  const [selectedResultIndex, setSelectedResultIndex] = useState(0)
  const [selectedBlock, setSelectedBlock] = useState<TextBlock | null>(null)
  const [selectedPageBlock, setSelectedPageBlock] = useState<PageBlock | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isReadyToProcess, setIsReadyToProcess] = useState(false)
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
      results.push({
        id: `${d.id}-${i}`,
        fileName: f.fileName,
        imageDataUrl: f.imageDataUrl,
        textBlocks: f.textBlocks,
        fullText: f.fullText,
        processingTimeMs: f.processingTimeMs,
        createdAt: d.createdAt,
      })
    }
    restoreImages(imgs)
    setSessionResults(results)
    setSelectedResultIndex(0)
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
      setSelectedResultIndex(0)
      resetState()

      const runId = crypto.randomUUID()
      setCurrentRunId(runId)
      const runCreatedAt = Date.now()
      const successItems: Array<{ result: OCRResult; thumbnailDataUrl: string }> = []
      const sessionResultsAccum: OCRResult[] = []

      for (let i = 0; i < processedImages.length; i++) {
        const image = processedImages[i]
        try {
          const result = await processImage(image, i, processedImages.length, orientation)
          successItems.push({ result, thumbnailDataUrl: image.thumbnailDataUrl })
          sessionResultsAccum.push(result)
          setSessionResults([...sessionResultsAccum])
          setSelectedResultIndex(sessionResultsAccum.length - 1)
        } catch (err) {
          console.error(`OCR failed for ${image.fileName}:`, err)
        }
      }

      if (successItems.length > 0) {
        const runEntry: DBRunEntry = {
          id: runId,
          files: successItems.map(({ result, thumbnailDataUrl }) => ({
            fileName: result.fileName,
            imageDataUrl: thumbnailDataUrl,
            textBlocks: result.textBlocks,
            fullText: result.fullText,
            processingTimeMs: result.processingTimeMs,
          })),
          createdAt: runCreatedAt,
        }
        await saveRun(runEntry)
      }

      setIsProcessing(false)
      setIsReadyToProcess(false)
    }

    runOCR()
  }, [isReadyToProcess]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    clearImages()
    setSessionResults([])
    setSelectedResultIndex(0)
    setSelectedBlock(null)
    setSelectedPageBlock(null)
    resetState()
    setIsProcessing(false)
    setIsReadyToProcess(false)
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
        b.readingOrder === target.readingOrder ? { ...b, text: newText } : b
      )
      const fullText = textBlocks.filter(b => b.text).map(b => b.text).join('\n')
      return { ...r, textBlocks, fullText }
    }))
    setSelectedBlock(prev =>
      prev && prev.readingOrder === target.readingOrder ? { ...prev, text: newText } : prev
    )
  }, [selectedResultIndex])

  // 認識行の読み順を入れ替え（↑↓）。隣の行と readingOrder を交換し、fullText を再構成。
  // textBlocks を更新するので PDF・ePub・Word・コピーすべてに反映される。
  const handleMoveBlock = useCallback((target: TextBlock, dir: 'up' | 'down') => {
    setSessionResults(prev => prev.map((r, i) => {
      if (i !== selectedResultIndex) return r
      const sorted = [...r.textBlocks].sort((a, b) => a.readingOrder - b.readingOrder)
      const idx = sorted.findIndex(b => b.readingOrder === target.readingOrder)
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return r
      const aOrder = sorted[idx].readingOrder
      const bOrder = sorted[swapIdx].readingOrder
      const textBlocks = r.textBlocks.map(blk =>
        blk.readingOrder === aOrder ? { ...blk, readingOrder: bOrder }
          : blk.readingOrder === bOrder ? { ...blk, readingOrder: aOrder }
          : blk
      )
      const fullText = [...textBlocks].sort((x, y) => x.readingOrder - y.readingOrder)
        .filter(b => b.text).map(b => b.text).join('\n')
      return { ...r, textBlocks, fullText }
    }))
  }, [selectedResultIndex])

  const handleHistorySelect = (run: DBRunEntry) => {
    const restoredResults: OCRResult[] = run.files.map((file, i) => ({
      id: `${run.id}-${i}`,
      fileName: file.fileName,
      imageDataUrl: file.imageDataUrl,
      textBlocks: file.textBlocks,
      fullText: file.fullText,
      processingTimeMs: file.processingTimeMs,
      createdAt: run.createdAt,
    }))
    setSessionResults(restoredResults)
    setSelectedResultIndex(0)
    setSelectedBlock(null)
    setSelectedPageBlock(null)
    setShowHistory(false)
  }

  const isModelLoading = jobState.status === 'loading_model'
  const isWorking = isLoadingFiles || isProcessing
  const hasResults = sessionResults.length > 0
  const hasPendingImages = processedImages.length > 0 && !isWorking && !hasResults

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
        {!hasResults && !isWorking && !isModelLoading && !hasPendingImages && (
          <section className="upload-section">
            <FileDropZone onFilesSelected={handleFilesSelected} lang={lang} disabled={isWorking} />
            <div className="upload-actions">
              <DirectoryPicker onFilesSelected={handleFilesSelected} lang={lang} disabled={isWorking} />
              <button className="btn btn-secondary" onClick={handlePasteFromClipboard} disabled={isWorking}>
                {lang === 'ja' ? 'クリップボードから貼り付け' : 'Paste from Clipboard'}
              </button>
              <button className="btn btn-secondary" onClick={handleSampleLoad} disabled={isWorking}>
                {lang === 'ja' ? 'サンプルを試す' : 'Try Sample'}
              </button>
            </div>
          </section>
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

        {(hasResults || isProcessing) && processedImages.length > 0 && (
          <section className="result-section">
            {/* 左サイドバー: 全ファイル一覧（未完了も含む） */}
            {processedImages.length > 1 && (
              <div className="result-sidebar">
                {processedImages.map((img, i) => {
                  const result = sessionResults[i]
                  const isInProgress = !result && isProcessing && i === sessionResults.length
                  const isPending = !result && !isInProgress
                  return (
                    <button
                      key={i}
                      className={`result-sidebar-item ${result && i === selectedResultIndex ? 'active' : ''} ${isPending || isInProgress ? 'sidebar-pending' : ''}`}
                      onClick={() => { if (result) { setSelectedResultIndex(i); setSelectedBlock(null) } }}
                      disabled={!result}
                      title={img.pageIndex ? `${img.fileName} (p.${img.pageIndex})` : img.fileName}
                    >
                      <div className="result-sidebar-thumb-wrap">
                        <img src={result ? result.imageDataUrl : img.thumbnailDataUrl} alt={img.fileName} />
                        {isInProgress && <div className="sidebar-item-spinner" />}
                      </div>
                      <span className="result-sidebar-label">
                        {img.pageIndex ? `${img.fileName} (p.${img.pageIndex})` : img.fileName}
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
                  {processedImages.map((img, i) => {
                    const label = img.pageIndex ? `${img.fileName} (p.${img.pageIndex})` : img.fileName
                    return (
                      <option key={i} value={i} disabled={i >= sessionResults.length}>
                        {i + 1} / {processedImages.length}　{label}
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
                  {currentResult && (
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
                </div>

                <div
                  className={`result-divider${isDraggingDivider ? ' dragging' : ''}`}
                  onMouseDown={startDividerDrag}
                  role="separator"
                  aria-orientation="vertical"
                  title={lang === 'ja' ? 'ドラッグで幅を調整' : 'Drag to resize'}
                />

                <div className="result-right">
                  <ResultPanel result={currentResult} selectedBlock={selectedBlock} selectedPageBlockText={selectedPageBlockText} onEditBlock={handleEditBlock} onMoveBlock={handleMoveBlock} lang={lang} />
                  <ResultActions results={sessionResults} currentResult={currentResult} processedImages={processedImages} orientation={orientation} lang={lang} />
                </div>
              </div>

            </div>
          </section>
        )}
      </main>

      <Footer lang={lang} />

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
    </div>
  )
}
