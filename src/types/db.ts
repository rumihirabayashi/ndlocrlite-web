import type { TextBlock } from './ocr'

export interface DBModelEntry {
  name: string // 'layout' | 'recognition'
  data: ArrayBuffer
  cachedAt: number // Unix timestamp (ms)
  version: string // モデルのバージョン管理用
}

// 1回の実行に含まれる1ファイル分の結果
export interface DBRunFile {
  fileName: string
  imageDataUrl: string // 縮小サムネイル (base64)
  textBlocks: TextBlock[]
  fullText: string
  processingTimeMs: number
  imageFullDataUrl?: string // フル解像度画像 (base64)。一時保存(ドラフト)の復元・PDF再出力用
  pageIndex?: number        // PDFのページ番号（1始まり）
}

// 1回の実行（複数ファイルをまとめた単位）
export interface DBRunEntry {
  id: string         // runId (UUID)
  files: DBRunFile[] // この実行で処理したファイル一覧
  createdAt: number  // Unix timestamp (ms)
}
