/**
 * モデルファイルのダウンロード・IndexedDBキャッシュ管理
 * 参照実装: ndlkotenocr-worker/src/utils/model-loader.js
 */

const DB_NAME = 'NDLOCRLiteDB'
const DB_VERSION = 2
const STORE_NAME = 'models'

// モデルのバージョン（URLが変わったらここを更新）
export const MODEL_VERSION = '2.0.0'

// モデル配信ベースURL。既定は同一オリジンの /models（自前配信）。
// 外部CDN(R2)はドメイン限定CORSのため別ドメインから使えない → 自前配信に統一。
const MODEL_BASE_URL = (import.meta.env.VITE_MODEL_BASE_URL as string | undefined) ?? '/models'

// ONNXモデルのURL（すべて同一オリジン /models から配信＝COEP環境でも安全）
export const MODEL_URLS: Record<string, string> = {
  layout: `${MODEL_BASE_URL}/deim-s-1024x1024.onnx`,
  // カスケード文字認識モデル（行の文字数カテゴリに応じて使い分け・202604版）
  recognition30: `${MODEL_BASE_URL}/parseq-30.onnx`,   // カテゴリ3: ≤30文字 [1,3,24,256]
  recognition50: `${MODEL_BASE_URL}/parseq-50.onnx`,   // カテゴリ2: ≤50文字 [1,3,24,384]
  recognition100: `${MODEL_BASE_URL}/parseq-100.onnx`, // カテゴリ1: ≤100文字 [1,3,24,768]
}

function initDB(): Promise<IDBDatabase> {
  const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models', { keyPath: 'name' })
      }
      // Version 2: results ストアを再作成（per-run スキーマ）
      if (db.objectStoreNames.contains('results')) {
        db.deleteObjectStore('results')
      }
      const resultsStore = db.createObjectStore('results', { keyPath: 'id' })
      resultsStore.createIndex('by_createdAt', 'createdAt', { unique: false })
    }
  })

  // iOS/iPadOS Safariには indexedDB.open のコールバックが永遠に発火しない既知のバグがあるため、
  // 3秒でタイムアウトしてダウンロードにフォールバックできるようにする
  const timeout = new Promise<IDBDatabase>((_, reject) => {
    setTimeout(() => reject(new Error('indexedDB.open timed out')), 3000)
  })

  return Promise.race([dbPromise, timeout])
}

async function getModelFromCache(
  modelName: string
): Promise<ArrayBuffer | undefined> {
  try {
    const db = await initDB()
    return await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(modelName)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const entry = request.result
        if (entry && entry.version === MODEL_VERSION) {
          resolve(entry.data)
        } else {
          resolve(undefined)
        }
      }
    })
  } catch (error) {
    // IndexedDBが使えない・タイムアウトした場合はキャッシュなし扱いにしてダウンロードへフォールバック
    console.warn(`IndexedDB cache read failed for ${modelName}, falling back to download:`, error)
    return undefined
  }
}

async function saveModelToCache(
  modelName: string,
  data: ArrayBuffer
): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.put({
      name: modelName,
      data,
      cachedAt: Date.now(),
      version: MODEL_VERSION,
    })

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

async function downloadWithProgress(
  url: string,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  // SPAフォールバックでHTMLが返った場合（モデルファイルが存在しない）を検出
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    throw new Error(`Model file not found (HTML returned): ${url}`)
  }

  const contentLength = parseInt(
    response.headers.get('content-length') || '0',
    10
  )
  let receivedLength = 0

  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    chunks.push(value)
    receivedLength += value.length

    if (onProgress && contentLength > 0) {
      onProgress(receivedLength / contentLength)
    }
  }

  const allChunks = new Uint8Array(receivedLength)
  let position = 0
  for (const chunk of chunks) {
    allChunks.set(chunk, position)
    position += chunk.length
  }

  return allChunks.buffer
}

export async function loadModel(
  modelType: string,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  const modelUrl = MODEL_URLS[modelType]
  if (!modelUrl) {
    throw new Error(`Unknown model type: ${modelType}`)
  }

  const cached = await getModelFromCache(modelType)
  if (cached) {
    console.log(`Model ${modelType} loaded from cache`)
    if (onProgress) onProgress(1.0)
    return cached
  }

  console.log(`Downloading model ${modelType} from ${modelUrl}`)
  const modelData = await downloadWithProgress(modelUrl, onProgress)

  // IndexedDBへの保存はawaitせずfire-and-forgetにする。
  // iOS SafariのIDB openバグや40MB級書き込みの遅さで初期化がハングするのを防ぐため。
  // 配信元（Cloudflare R2 / 自前配信）はCache-Control: immutable付きなので、
  // IDBキャッシュが効かなくてもHTTPキャッシュで十分カバーできる。
  saveModelToCache(modelType, modelData)
    .then(() => console.log(`Model ${modelType} cached successfully`))
    .catch((error) => console.warn(`Failed to cache model ${modelType} in IndexedDB:`, error))

  return modelData
}

export async function clearModelCache(): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.clear()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}
