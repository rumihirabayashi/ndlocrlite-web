/**
 * IndexedDB 低レベル操作
 * DB名: NDLOCRLiteDB, Version: 2
 * ストア: models (ONNXモデルキャッシュ), results (OCR実行履歴)
 */

import type { DBRunEntry } from '../types/db'

const DB_NAME = 'NDLOCRLiteDB'
const DB_VERSION = 2
const RESULTS_MAX = 100
const DRAFT_ID = '__draft__' // 一時保存（校正中の作業）用の予約ID

let dbInstance: IDBDatabase | null = null

export function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models', { keyPath: 'name' })
      }

      // Version 2: results ストアを再作成（per-run スキーマに変更）
      if (db.objectStoreNames.contains('results')) {
        db.deleteObjectStore('results')
      }
      const store = db.createObjectStore('results', { keyPath: 'id' })
      store.createIndex('by_createdAt', 'createdAt', { unique: false })
    }
  })
}

// ---- results ストア ----

export async function saveRun(entry: DBRunEntry): Promise<void> {
  const db = await initDB()

  // 100件制限: 超えたら最古を削除
  const count = await countRuns(db)
  if (count >= RESULTS_MAX) {
    const oldest = await getOldestRun(db)
    if (oldest) await deleteRun(db, oldest.id)
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction('results', 'readwrite')
    const store = tx.objectStore('results')
    const req = store.put(entry)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

export async function getAllRuns(): Promise<DBRunEntry[]> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('results', 'readonly')
    const store = tx.objectStore('results')
    const index = store.index('by_createdAt')
    const req = index.getAll()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve((req.result as DBRunEntry[]).filter(r => r.id !== DRAFT_ID).reverse())
  })
}

// ---- 一時保存（ドラフト）：校正中の作業を自動保存／復元 ----
// 最適化のため、重いフル画像は「実行ごとに1回だけ」別レコードに保存し、
// 校正のたびに更新されるテキスト側レコードには画像を含めない。

const DRAFT_IMAGES_ID = '__draft_images__'

interface DraftImagesRecord {
  id: string       // = DRAFT_IMAGES_ID
  runId: string    // 対応するドラフトの runId（テキスト側と突き合わせ）
  urls: string[]   // ページ順のフル画像 dataURL
}

function putRecord(value: object): Promise<void> {
  return initDB().then(db => new Promise<void>((resolve, reject) => {
    const req = db.transaction('results', 'readwrite').objectStore('results').put(value)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  }))
}

function getRecord<T>(id: string): Promise<T | undefined> {
  return initDB().then(db => new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction('results', 'readonly').objectStore('results').get(id)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result as T | undefined)
  }))
}

function deleteRecord(id: string): Promise<void> {
  return initDB().then(db => new Promise<void>((resolve, reject) => {
    const req = db.transaction('results', 'readwrite').objectStore('results').delete(id)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  }))
}

/** テキスト側の保存（校正のたびに呼ぶ。フル画像は含めない＝軽量） */
export async function saveDraftText(entry: DBRunEntry): Promise<void> {
  const files = entry.files.map(f => {
    // imageFullDataUrl は除外（画像は別レコード）
    const { imageFullDataUrl: _omit, ...rest } = f
    void _omit
    return rest
  })
  await putRecord({ ...entry, id: DRAFT_ID, files })
}

/** フル画像の保存（実行ごとに1回だけ呼ぶ＝重い処理を毎回しない） */
export async function saveDraftImages(runId: string, urls: string[]): Promise<void> {
  const rec: DraftImagesRecord = { id: DRAFT_IMAGES_ID, runId, urls }
  await putRecord(rec)
}

/** テキスト＋（あれば）対応するフル画像をマージして復元データを返す */
export async function getDraft(): Promise<DBRunEntry | undefined> {
  const draft = await getRecord<DBRunEntry>(DRAFT_ID)
  if (!draft || !draft.files || draft.files.length === 0) return undefined
  const imgs = await getRecord<DraftImagesRecord>(DRAFT_IMAGES_ID)
  if (imgs && imgs.runId === draft.id) {
    draft.files = draft.files.map((f, i) => ({ ...f, imageFullDataUrl: imgs.urls[i] ?? f.imageFullDataUrl }))
  }
  return draft
}

export async function clearDraft(): Promise<void> {
  await deleteRecord(DRAFT_ID)
  await deleteRecord(DRAFT_IMAGES_ID)
}

export async function clearResults(): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('results', 'readwrite')
    const store = tx.objectStore('results')
    const req = store.clear()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

async function countRuns(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('results', 'readonly')
    const store = tx.objectStore('results')
    const req = store.count()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
}

async function getOldestRun(db: IDBDatabase): Promise<DBRunEntry | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('results', 'readonly')
    const store = tx.objectStore('results')
    const index = store.index('by_createdAt')
    const req = index.openCursor(null, 'next') // 昇順（最古が最初）
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const cursor = req.result
      resolve(cursor ? (cursor.value as DBRunEntry) : undefined)
    }
  })
}

async function deleteRun(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('results', 'readwrite')
    const store = tx.objectStore('results')
    const req = store.delete(id)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

// ---- models ストア ----

export async function clearModels(): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite')
    const store = tx.objectStore('models')
    const req = store.clear()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}
