/**
 * OCR Web Worker
 * バックグラウンドでOCR処理を実行
 * 参照実装: ndlkotenocr-worker/src/worker/ocr-worker.js
 *
 * メッセージ種別:
 *   OCR_PROCESS   : 領域OCR用（逐次認識。processRegion で使用）
 *   LAYOUT_DETECT : バッチOCR用（レイアウト検出のみ実行し LAYOUT_DONE を返す）
 *                   認識フェーズはメインスレッドが N 本の recognition.worker に並列委譲する
 *
 * カスケード文字認識（モデル入力高さは 24px 固定。recognition.worker と一致させること）:
 *   charCountCategory=3 → recognizer30 (24×256, ≤30文字)
 *   charCountCategory=2 → recognizer50 (24×384, ≤50文字)
 *   それ以外            → recognizer100 (24×768, ≤100文字)
 */

import './onnx-config'
import { clampWasmMemoryForMobile } from './onnx-config'
import { loadModel, clearModelCache } from './model-loader'
import { LayoutDetector } from './layout-detector'
import { TextRecognizer } from './text-recognizer'
import { ReadingOrderProcessor, extractFolio, type Orientation } from './reading-order'
import type { TextBlock } from '../types/ocr'
import type { WorkerInMessage, WorkerOutMessage } from '../types/worker'

/** wasm-feature-detect と同じ手法でWebAssembly SIMD対応を検出する（onnxruntime-web 1.20はSIMD必須） */
function isWasmSimdSupported(): boolean {
  return WebAssembly.validate(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
  ]))
}

/** Promise に120秒のタイムアウトを付与する（ONNXセッション作成が例外を投げずにハングするケースに備える） */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}

/**
 * ONNXセッション作成（initFn）を実行し、失敗したらモデルキャッシュを破棄→強制再ダウンロードで1回だけリトライする。
 * iPadOS 17でIndexedDBから読み戻した40MB級モデルが破損しているケース（iOS Safari既知バグ）で、
 * 「Can't create a session ... ResolveKernelTypeStr ...」のような深部エラーになるのを自己修復するための仕組み。
 * 初回データ（キャッシュ or 通常ダウンロード）はすでに呼び出し元で取得済みのものを渡す想定。
 */
async function initializeWithRetry(
  label: string,
  initialData: ArrayBuffer,
  initFn: (data: ArrayBuffer) => Promise<void>,
  reloadFresh: () => Promise<ArrayBuffer>,
  onRetry: () => void
): Promise<void> {
  try {
    await initFn(initialData)
  } catch (error) {
    console.warn(`Failed to create ONNX session for ${label}, discarding model cache and retrying with a fresh download:`, error)
    await clearModelCache().catch(() => {})
    onRetry()
    const freshData = await reloadFresh()
    await initFn(freshData)
  }
}

/**
 * OOM系エラー（iOS 17のWASMメモリ予約リークが原因のことが多い）に対し、
 * 復旧手順の案内をメッセージ先頭に付加する。再読み込みでは解消せず、
 * タブを閉じて開き直す必要があるのが特徴（onnxruntime-web 1.19以降のpthreadビルドが
 * 確保する共有メモリをiOS 17のWebKitが解放し損ねるバグ。iOS 18で修正済み）。
 * 該当しないメッセージはそのまま返す。
 */
function withRecoveryHint(message: string): string {
  if (/out of memory|no available backend/i.test(message)) {
    return 'メモリの確保に失敗しました。お使いのOSのSafariの既知の問題です。【対処】このタブを閉じて、新しいタブで開き直してください（再読み込みでは改善しません）。iPadOS/iOS 18以降に更新すると根本的に解消します。\n詳細: ' + message
  }
  return message
}

class OCRWorker {
  private layoutDetector: LayoutDetector | null = null
  private recognizer30: TextRecognizer | null = null  // ≤30文字 [1,3,16,256]
  private recognizer50: TextRecognizer | null = null  // ≤50文字 [1,3,16,384]
  private recognizer100: TextRecognizer | null = null // ≤100文字 [1,3,16,768]
  private readingOrderProcessor = new ReadingOrderProcessor()
  private isInitialized = false
  private layoutOnly = false

  private post(message: WorkerOutMessage) {
    self.postMessage(message)
  }

  async initialize(layoutOnly = false): Promise<void> {
    if (this.isInitialized) return
    this.layoutOnly = layoutOnly

    try {
      // モバイル（iPad/iPhone/Android）ではWASMメモリ確保上限をクランプする。
      // layoutOnly はモバイル判定済みフラグとしてメインスレッドから渡される
      // （WorkerのUAではiPadを判別できないため、メインスレッドの判定をここで流用する設計）。
      if (layoutOnly) clampWasmMemoryForMobile()

      // モデルダウンロード前にWASM SIMD対応を確認（非対応環境ではこの先ハング/失敗するため先に検出する）
      if (!isWasmSimdSupported()) {
        throw new Error('この端末のブラウザはWebAssembly SIMDに対応していません。iPadOS/iOSを16.4以降に更新してください。(WebAssembly SIMD not supported)')
      }

      this.post({
        type: 'OCR_PROGRESS',
        stage: 'initializing',
        progress: 0.02,
        message: 'Initializing...',
      })

      if (layoutOnly) {
        // モバイル: レイアウトモデルのみロード（認識モデルは processOCR 時に遅延ロード）
        const layoutModelData = await loadModel('layout', (p) => {
          this.post({
            type: 'OCR_PROGRESS',
            stage: 'loading_models',
            progress: 0.02 + p * 0.73,
            message: `Loading models... ${Math.round(p * 100)}%`,
            modelProgress: { layout: p, rec30: 0, rec50: 0, rec100: 0 },
          })
        })
        this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.76, message: 'Preparing layout model...' })
        this.layoutDetector = new LayoutDetector()
        // ONNXセッション作成が例外を投げずに永久にハングする可能性があるため120秒でタイムアウトさせる。
        // 失敗時はキャッシュ破棄＋強制再ダウンロードで1回だけリトライする（モバイル経路のみ）
        await initializeWithRetry(
          'layout model',
          layoutModelData,
          (data) => withTimeout(
            this.layoutDetector!.initialize(data),
            120_000,
            'モデルの準備がタイムアウトしました（WASM初期化に失敗の可能性）'
          ),
          () => loadModel('layout', undefined, { forceFresh: true }),
          () => this.post({
            type: 'OCR_PROGRESS',
            stage: 'initializing_models',
            progress: 0.76,
            message: 'Retrying with fresh model download...',
          })
        )
      } else {
        // デスクトップ: 4モデルを並列ダウンロード（各モデルの進捗を合算してレポート）
        const progresses = { layout: 0, rec30: 0, rec50: 0, rec100: 0 }
        const reportProgress = () => {
          const avg = (progresses.layout + progresses.rec30 + progresses.rec50 + progresses.rec100) / 4
          this.post({
            type: 'OCR_PROGRESS',
            stage: 'loading_models',
            progress: 0.02 + avg * 0.73,
            message: `Loading models... ${Math.round(avg * 100)}%`,
            modelProgress: { ...progresses },
          })
        }

        const [layoutModelData, rec30Data, rec50Data, rec100Data] = await Promise.all([
          loadModel('layout',        (p) => { progresses.layout = p; reportProgress() }),
          loadModel('recognition30', (p) => { progresses.rec30  = p; reportProgress() }),
          loadModel('recognition50', (p) => { progresses.rec50  = p; reportProgress() }),
          loadModel('recognition100',(p) => { progresses.rec100 = p; reportProgress() }),
        ])

        // ONNXセッション作成（WASMシングルスレッドのため直列）。永久ハング対策で120秒タイムアウトを設ける
        this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.76, message: 'Preparing layout model...' })
        this.layoutDetector = new LayoutDetector()
        await withTimeout(
          this.layoutDetector.initialize(layoutModelData),
          120_000,
          'モデルの準備がタイムアウトしました（WASM初期化に失敗の可能性）'
        )

        this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.83, message: 'Preparing recognition model (30)...' })
        this.recognizer30 = new TextRecognizer([1, 3, 24, 256])
        await this.recognizer30.initialize(rec30Data)

        this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.90, message: 'Preparing recognition model (50)...' })
        this.recognizer50 = new TextRecognizer([1, 3, 24, 384])
        await this.recognizer50.initialize(rec50Data)

        this.post({ type: 'OCR_PROGRESS', stage: 'initializing_models', progress: 0.96, message: 'Preparing recognition model (100)...' })
        this.recognizer100 = new TextRecognizer([1, 3, 24, 768])
        await this.recognizer100.initialize(rec100Data)
      }

      this.isInitialized = true

      this.post({
        type: 'OCR_PROGRESS',
        stage: 'initialized',
        progress: 1.0,
        message: 'Ready',
      })
    } catch (error) {
      // 壊れたモデルキャッシュが原因で初期化に失敗し続けるループを断ち切るため、
      // IndexedDBのモデルキャッシュを破棄する（失敗しても握りつぶす）
      clearModelCache().catch(() => {})
      // スクリーンショットだけで原因特定できるよう、エラー名とUAを1行付加する
      const err = error as Error
      const diagnosticMessage = `${err.message} [${err.name}] / UA: ${navigator.userAgent} / build: ${__BUILD_ID__}（モデルキャッシュを破棄しました。ページを再読み込みすると再ダウンロードされます）`
      this.post({
        type: 'OCR_ERROR',
        error: withRecoveryHint(diagnosticMessage),
        stage: 'initialization',
      })
      throw error
    }
  }

  /** 認識モデルを遅延ロード（layoutOnly モードで processOCR が呼ばれた場合） */
  private async ensureRecognizers(id?: string): Promise<void> {
    if (this.recognizer100) return  // rec100 があれば最低限OK

    try {
      if (this.layoutOnly) {
        // モバイル: rec100 のみ（WASM ランタイムを 1 つに抑えるため）。
        // モバイル回線ではダウンロードに時間がかかるため、進捗をUIに通知する
        // （layout_detection が progress 0.1 から始まるので、それに合わせて 0〜0.1 の範囲を使う）
        const rec100Data = await loadModel('recognition100', (p) => {
          this.post({
            type: 'OCR_PROGRESS',
            id,
            stage: 'loading_recognition_model',
            progress: p * 0.1,
            message: `Loading recognition model... ${Math.round(p * 100)}%`,
          })
        })
        this.recognizer100 = new TextRecognizer([1, 3, 24, 768])
        // 失敗時はキャッシュ破棄＋強制再ダウンロードで1回だけリトライする
        await initializeWithRetry(
          'recognition100 model',
          rec100Data,
          (data) => this.recognizer100!.initialize(data),
          () => loadModel('recognition100', undefined, { forceFresh: true }),
          () => this.post({
            type: 'OCR_PROGRESS',
            id,
            stage: 'loading_recognition_model',
            progress: 0.1,
            message: 'Retrying with fresh model download...',
          })
        )
      } else {
        // デスクトップ: 3モデル全部
        if (this.recognizer30 && this.recognizer50) return
        const [rec30Data, rec50Data, rec100Data] = await Promise.all([
          loadModel('recognition30'),
          loadModel('recognition50'),
          loadModel('recognition100'),
        ])
        this.recognizer30 = new TextRecognizer([1, 3, 24, 256])
        await this.recognizer30.initialize(rec30Data)
        this.recognizer50 = new TextRecognizer([1, 3, 24, 384])
        await this.recognizer50.initialize(rec50Data)
        this.recognizer100 = new TextRecognizer([1, 3, 24, 768])
        await this.recognizer100.initialize(rec100Data)
      }
    } catch (error) {
      // initialize() 同様、壊れたキャッシュによる失敗ループを断ち切るためキャッシュを破棄する
      clearModelCache().catch(() => {})
      const err = error as Error
      err.message = `${err.message}（モデルキャッシュを破棄しました。ページを再読み込みすると再ダウンロードされます）`
      throw err
    }
  }

  /** charCountCategory に応じたモデルを選択 */
  private selectRecognizer(charCountCategory?: number): TextRecognizer {
    if (!this.layoutOnly) {
      if (charCountCategory === 3) return this.recognizer30!
      if (charCountCategory === 2) return this.recognizer50!
    }
    return this.recognizer100!  // モバイルは常に rec100
  }

  /** 領域OCR用: レイアウト検出 + 逐次認識 + 読み順処理 (processRegion から使用) */
  async processOCR(id: string, imageData: ImageData, startTime: number, orientation: Orientation = 'auto'): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize()
      }
      await this.ensureRecognizers(id)

      // Stage 1: レイアウト検出
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'layout_detection',
        progress: 0.1,
        message: 'Detecting text regions...',
      })

      const { lines: textRegions, blocks: pageBlocks } = await this.layoutDetector!.detect(
        imageData,
        (progress) => {
          this.post({
            type: 'OCR_PROGRESS',
            id,
            stage: 'layout_detection',
            progress: 0.1 + progress * 0.3,
            message: `Detecting regions... ${Math.round(progress * 100)}%`,
          })
        }
      )

      // Stage 2: 逐次文字認識（cropImageDataBatch で sourceCanvas を1回だけ生成）
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'text_recognition',
        progress: 0.4,
        message: `Recognizing text in ${textRegions.length} regions...`,
      })

      const croppedImages = TextRecognizer.cropImageDataBatch(imageData, textRegions)
      const recognitionResults: TextBlock[] = []
      for (let i = 0; i < textRegions.length; i++) {
        const region = textRegions[i]
        const recognizer = this.selectRecognizer(region.charCountCategory)
        const result = await recognizer.recognizeCropped(croppedImages[i])

        recognitionResults.push({
          ...region,
          text: result.text,
          readingOrder: i + 1,
        })

        this.post({
          type: 'OCR_PROGRESS',
          id,
          stage: 'text_recognition',
          progress: 0.4 + ((i + 1) / textRegions.length) * 0.4,
          message: `Recognized ${i + 1}/${textRegions.length} regions`,
        })
      }

      // Stage 3: 読み順処理
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'reading_order',
        progress: 0.8,
        message: 'Processing reading order...',
      })

      // ノンブル（書籍ページ番号）を本文から分離（実験的）
      const { rest, folio } = extractFolio(recognitionResults)
      // 読み順整序（組み方向を反映・引用早閉じ補正もこの中で実施）
      const orderedResults = this.readingOrderProcessor.process(rest, pageBlocks, { orientation })

      // Stage 4: 出力生成
      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'generating_output',
        progress: 0.9,
        message: 'Generating output...',
      })

      const txt = orderedResults
        .filter((b) => b.text)
        .map((b) => b.text)
        .join('\n')

      this.post({
        type: 'OCR_COMPLETE',
        id,
        textBlocks: orderedResults,
        txt,
        processingTime: Date.now() - startTime,
        folio,
      })
    } catch (error) {
      // スクリーンショットだけで原因特定できるよう、エラー名とUAを1行付加する（initializeと同様）
      const err = error as Error
      this.post({
        type: 'OCR_ERROR',
        id,
        error: withRecoveryHint(`${err.message} [${err.name}] / UA: ${navigator.userAgent} / build: ${__BUILD_ID__}`),
      })
    }
  }

  /** バッチOCR用: レイアウト検出のみ実行し LAYOUT_DONE を返す (processImage から使用) */
  async detectLayout(id: string, imageData: ImageData, startTime: number): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize()
      }

      this.post({
        type: 'OCR_PROGRESS',
        id,
        stage: 'layout_detection',
        progress: 0.1,
        message: 'Detecting text regions...',
      })

      const { lines: textRegions, blocks: pageBlocks } = await this.layoutDetector!.detect(
        imageData,
        (progress) => {
          this.post({
            type: 'OCR_PROGRESS',
            id,
            stage: 'layout_detection',
            progress: 0.1 + progress * 0.3,
            message: `Detecting regions... ${Math.round(progress * 100)}%`,
          })
        }
      )

      // 各領域を事前クロップ（メインスレッドに Transferable で返す）
      const croppedImages = TextRecognizer.cropImageDataBatch(imageData, textRegions)
      const transferables = croppedImages.map(img => img.data.buffer)

      self.postMessage(
        { type: 'LAYOUT_DONE', id, textRegions, croppedImages, pageBlocks, startTime } satisfies WorkerOutMessage,
        { transfer: transferables }
      )
    } catch (error) {
      this.post({
        type: 'OCR_ERROR',
        id,
        error: (error as Error).message,
      })
    }
  }
}

const ocrWorker = new OCRWorker()

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data

  switch (message.type) {
    case 'INITIALIZE':
      await ocrWorker.initialize(message.layoutOnly)
      break

    case 'OCR_PROCESS':
      await ocrWorker.processOCR(message.id, message.imageData, message.startTime, message.orientation)
      break

    case 'LAYOUT_DETECT':
      await ocrWorker.detectLayout(message.id, message.imageData, message.startTime)
      break

    case 'TERMINATE':
      self.close()
      break
  }
}

self.onerror = (error) => {
  const message = typeof error === 'string' ? error : (error as ErrorEvent).message ?? 'Unknown error'
  self.postMessage({
    type: 'OCR_ERROR',
    error: message,
  } satisfies WorkerOutMessage)
}
