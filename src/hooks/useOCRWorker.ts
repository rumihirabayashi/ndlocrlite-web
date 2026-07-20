import { useRef, useState, useCallback, useEffect } from 'react'
import type { OCRJobState, OCRResult, ProcessedImage, TextBlock, TextRegion, PageBlock } from '../types/ocr'
import type { WorkerInMessage, WorkerOutMessage } from '../types/worker'
import type { RecWorkerInMessage, RecWorkerOutMessage } from '../types/recognition-worker'
import { imageDataToDataUrl } from '../utils/imageLoader'
import { ReadingOrderProcessor, extractFolio, type Orientation } from '../worker/reading-order'
// ?worker import → Vite が recognition.worker.ts を独立バンドルして Worker コンストラクタを返す
import RecognitionWorkerFactory from '../worker/recognition.worker.ts?worker'

// iPadOS 13+ のSafariはUAが「Macintosh」を名乗るため、タッチ点数で判別する
const isMobile =
  /iPhone|iPad|Android/i.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

// deviceMemory はChrome系のみ提供（0.25/0.5/1/2/4/8 の離散値。4GB機は 4 を返す）
const deviceMemoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
// 4GB Chromebook（GIGA端末）はデスクトップUAだが、フルモード（認識ワーカー8本×モデル3本＋
// メインOCR4モデル＝計28 ONNXセッション）を確保しきれずメモリ枯渇でフリーズする。
// deviceMemory<=4 を低メモリ端末とみなし、軽量モード（layoutOnly + singleModel + 認識ワーカー0本）へ流す。
const isLowMemory = deviceMemoryGB !== undefined && deviceMemoryGB <= 4

// ?lite=1 で軽量モード強制ON、?lite=0 で強制OFF（問い合わせ対応時の切り分け用スイッチ）。
// それ以外は自動判定（モバイル or 低メモリ端末なら軽量モード）。
const liteParam = new URLSearchParams(location.search).get('lite')
const isLite = liteParam === '1' ? true : liteParam === '0' ? false : (isMobile || isLowMemory)

const N_REC_WORKERS = isLite ? 0 : Math.min(Math.max(navigator.hardwareConcurrency ?? 4, 2), 8)
const readingOrderProcessor = new ReadingOrderProcessor()

const initialJobState: OCRJobState = {
  status: 'idle',
  currentFile: '',
  currentFileIndex: 0,
  totalFiles: 0,
  stageProgress: 0,
  stage: '',
  message: '',
}

export function useOCRWorker() {
  const workerRef = useRef<Worker | null>(null)
  const recWorkersRef = useRef<Worker[]>([])
  const [isReady, setIsReady] = useState(false)
  const [jobState, setJobState] = useState<OCRJobState>(initialJobState)

  // OCR Worker + 認識 Worker を起動
  useEffect(() => {
    // スクリーンショットだけでモード特定できるよう、判定結果を1回だけ出力する
    console.log('[PitattoLens] mode:', isLite ? 'lite' : 'full', '| deviceMemory:', deviceMemoryGB, '| cores:', navigator.hardwareConcurrency, '| recWorkers:', N_REC_WORKERS)
    const worker = new Worker(
      new URL('../worker/ocr.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    // N 本の認識 Worker を ?worker import から生成（Vite が正しくバンドル）
    const recWorkers: Worker[] = Array.from({ length: N_REC_WORKERS }, () => new RecognitionWorkerFactory())
    recWorkersRef.current = recWorkers

    // 初期化完了フラグ（OCR Worker + 認識 Workers の両方が揃ったら isReady = true）
    let ocrWorkerReady = false
    let recReadyCount = 0

    const checkBothReady = () => {
      if (ocrWorkerReady && (N_REC_WORKERS === 0 || recReadyCount >= N_REC_WORKERS)) {
        setIsReady(true)
        setJobState(initialJobState)
      }
    }

    // OCR Worker 初期化
    worker.postMessage({ type: 'INITIALIZE', layoutOnly: isLite } satisfies WorkerInMessage)

    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data
      if (msg.type === 'OCR_PROGRESS') {
        if (msg.stage === 'initialized') {
          ocrWorkerReady = true
          checkBothReady()
        } else {
          setJobState((prev) => ({
            ...prev,
            status: 'loading_model',
            stageProgress: msg.progress,
            stage: msg.stage,
            message: msg.message,
            modelProgress: msg.modelProgress,
          }))
        }
      } else if (msg.type === 'OCR_ERROR') {
        // 初期化中のエラーを画面に表示する（従来はここで無視されて進捗バーが固まったまま見えていた）
        setJobState((prev) => ({ ...prev, status: 'error', errorMessage: msg.error }))
      }
    }

    // 認識 Worker 初期化
    recWorkers.forEach((w) => {
      w.onmessage = (e: MessageEvent<RecWorkerOutMessage>) => {
        if (e.data.type === 'REC_READY') {
          recReadyCount++
          w.onmessage = null
          checkBothReady()
        }
        // REC_PROGRESS は初期化進捗として無視（OCR Worker のモデル進捗を主表示に使用）
      }
      w.postMessage({ type: 'REC_INIT', singleModel: isLite } satisfies RecWorkerInMessage)
    })

    return () => {
      worker.postMessage({ type: 'TERMINATE' } satisfies WorkerInMessage)
      worker.terminate()
      recWorkers.forEach((w) => {
        w.postMessage({ type: 'REC_TERMINATE' } satisfies RecWorkerInMessage)
        w.terminate()
      })
      workerRef.current = null
      recWorkersRef.current = []
    }
  }, [])

  /**
   * processImage: バッチOCR用（LAYOUT_DETECT → 並列認識 → 読み順）
   * OCR Worker でレイアウト検出のみ行い、認識フェーズは N 本の認識 Worker に並列委譲する。
   * imageData は参照を保持したいため Transferable を使わずに structured clone で送信。
   */
  const processImage = useCallback(
    (image: ProcessedImage, fileIndex: number, totalFiles: number, orientation: Orientation = 'auto'): Promise<OCRResult> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not initialized'))
          return
        }

        const id = `${Date.now()}-${fileIndex}`
        // imageData を転送前にキャプチャ（LAYOUT_DONE 受信後も参照可能にする）
        const imageDataUrl = imageDataToDataUrl(image.imageData)

        setJobState({
          status: 'processing',
          currentFile: image.fileName,
          currentFileIndex: fileIndex + 1,
          totalFiles,
          stageProgress: 0,
          stage: 'starting',
          message: '',
        })

        const handler = (event: MessageEvent<WorkerOutMessage>) => {
          const msg = event.data
          if (msg.id !== undefined && msg.id !== id) return

          if (msg.type === 'OCR_PROGRESS') {
            setJobState((prev) => ({
              ...prev,
              stageProgress: msg.progress,
              stage: msg.stage,
              message: msg.message,
              status: 'processing',
              modelProgress: msg.modelProgress,
            }))
          } else if (msg.type === 'OCR_COMPLETE') {
            // モバイル(OCR_PROCESS)パスの完了
            workerRef.current?.removeEventListener('message', handler)
            const fileName = image.pageIndex ? `${image.fileName} (p.${image.pageIndex})` : image.fileName
            setJobState((prev) => ({ ...prev, status: 'done', stageProgress: 1 }))
            resolve({
              id,
              fileName,
              imageDataUrl,
              textBlocks: msg.textBlocks,
              fullText: msg.txt,
              processingTimeMs: msg.processingTime,
              createdAt: Date.now(),
              folio: msg.folio,
            })
          } else if (msg.type === 'LAYOUT_DONE') {
            workerRef.current?.removeEventListener('message', handler)
            runRecognition(id, imageDataUrl, image, msg.textRegions, msg.croppedImages, msg.pageBlocks, msg.startTime, orientation, resolve, reject)
          } else if (msg.type === 'OCR_ERROR') {
            workerRef.current?.removeEventListener('message', handler)
            setJobState((prev) => ({
              ...prev,
              status: 'error',
              errorMessage: msg.error,
            }))
            reject(new Error(msg.error))
          }
        }

        workerRef.current.addEventListener('message', handler)

        if (N_REC_WORKERS === 0) {
          // モバイル: ocr.worker 1つで完結（recognition.worker なし）
          workerRef.current.postMessage({
            type: 'OCR_PROCESS',
            id,
            imageData: image.imageData,
            startTime: Date.now(),
            orientation,
          } satisfies WorkerInMessage)
        } else {
          // デスクトップ: LAYOUT_DETECT → 並列 recognition workers
          workerRef.current.postMessage({
            type: 'LAYOUT_DETECT',
            id,
            imageData: image.imageData,
            startTime: Date.now(),
          } satisfies WorkerInMessage)
        }
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  /** LAYOUT_DONE 後の認識フェーズを N 本の認識 Worker に並列委譲 */
  const runRecognition = (
    id: string,
    imageDataUrl: string,
    image: ProcessedImage,
    textRegions: TextRegion[],
    croppedImages: ImageData[],
    pageBlocks: PageBlock[],
    startTime: number,
    orientation: Orientation,
    resolve: (result: OCRResult) => void,
    reject: (error: Error) => void
  ) => {
    const recWorkers = recWorkersRef.current

    if (textRegions.length === 0) {
      const result: OCRResult = {
        id,
        fileName: image.pageIndex ? `${image.fileName} (p.${image.pageIndex})` : image.fileName,
        imageDataUrl,
        textBlocks: [],
        fullText: '',
        processingTimeMs: Date.now() - startTime,
        createdAt: Date.now(),
      }
      setJobState((prev) => ({ ...prev, status: 'done', stageProgress: 1 }))
      resolve(result)
      return
    }

    const activeWorkers = Math.min(recWorkers.length, textRegions.length)
    setJobState((prev) => ({
      ...prev,
      stageProgress: 0.4,
      stage: 'text_recognition',
      message: `Recognizing text in ${textRegions.length} regions (${activeWorkers} threads)...`,
    }))

    // インデックス均等分割（round-robin）
    const N = recWorkers.length
    type Job = { id: number; croppedImageData: ImageData; charCountCategory?: number }
    const chunks: Job[][] = Array.from({ length: N }, () => [])
    textRegions.forEach((region, i) => {
      chunks[i % N].push({ id: i, croppedImageData: croppedImages[i], charCountCategory: region.charCountCategory })
    })

    const dispatch = (worker: Worker, jobs: Job[]): Promise<Array<{ id: number; text: string; confidence: number }>> =>
      new Promise((res, rej) => {
        if (jobs.length === 0) { res([]); return }
        worker.onmessage = (e: MessageEvent<RecWorkerOutMessage>) => {
          if (e.data.type === 'REC_COMPLETE') {
            worker.onmessage = null
            res(e.data.results)
          } else if (e.data.type === 'REC_ERROR') {
            worker.onmessage = null
            rej(new Error(e.data.error))
          }
        }
        const transferables = jobs.map(j => j.croppedImageData.data.buffer)
        worker.postMessage({ type: 'REC_PROCESS', jobs } satisfies RecWorkerInMessage, transferables)
      })

    Promise.all(recWorkers.map((w, i) => dispatch(w, chunks[i])))
      .then((chunkResults) => {
        const allResults = chunkResults.flat()
        const resultMap = new Map(allResults.map(r => [r.id, r]))

        const recognitionResults: TextBlock[] = textRegions.map((region, i) => ({
          ...region,
          text: resultMap.get(i)?.text ?? '',
          readingOrder: i + 1,
        }))

        setJobState((prev) => ({
          ...prev,
          stageProgress: 0.8,
          stage: 'reading_order',
          message: 'Processing reading order...',
        }))

        // ノンブル（書籍ページ番号）を本文から分離してからreading-order（実験的）
        const { rest, folio } = extractFolio(recognitionResults)
        const orderedResults = readingOrderProcessor.process(rest, pageBlocks, { orientation })
        const txt = orderedResults.filter(b => b.text).map(b => b.text).join('\n')

        const result: OCRResult = {
          id,
          fileName: image.pageIndex ? `${image.fileName} (p.${image.pageIndex})` : image.fileName,
          imageDataUrl,
          textBlocks: orderedResults,
          fullText: txt,
          processingTimeMs: Date.now() - startTime,
          createdAt: Date.now(),
          pageBlocks,
          folio,
        }

        setJobState((prev) => ({ ...prev, status: 'done', stageProgress: 1 }))
        resolve(result)
      })
      .catch((err: Error) => {
        setJobState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: err.message,
        }))
        reject(err)
      })
  }

  /**
   * processRegion: 領域OCR用（OCR_PROCESS → 逐次認識、変更なし）
   */
  const processRegion = useCallback(
    (imageData: ImageData): Promise<{ textBlocks: TextBlock[]; fullText: string }> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not initialized'))
          return
        }

        const id = `region-${Date.now()}`

        const handler = (event: MessageEvent<WorkerOutMessage>) => {
          const msg = event.data
          if (msg.id !== id) return  // 他ジョブのメッセージを無視

          if (msg.type === 'OCR_COMPLETE') {
            workerRef.current?.removeEventListener('message', handler)
            resolve({ textBlocks: msg.textBlocks, fullText: msg.txt })
          } else if (msg.type === 'OCR_ERROR') {
            workerRef.current?.removeEventListener('message', handler)
            reject(new Error(msg.error))
          }
          // OCR_PROGRESS は意図的に無視（jobState に影響させない）
        }

        workerRef.current.addEventListener('message', handler)
        workerRef.current.postMessage(
          { type: 'OCR_PROCESS', id, imageData, startTime: Date.now() } satisfies WorkerInMessage,
          [imageData.data.buffer]  // Transferable でゼロコピー転送
        )
      })
    },
    []
  )

  const resetState = useCallback(() => {
    setJobState(initialJobState)
  }, [])

  return { isReady, jobState, processImage, processRegion, resetState }
}
