export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface TextRegion extends BoundingBox {
  confidence: number
  classId: number
  charCountCategory?: number // DEIMモデルが出力する文字数カテゴリ (1, 2, 3)
}

export interface TextBlock extends TextRegion {
  text: string
  readingOrder: number
  uid?: string // 行の安定ID（読み順の並べ替え・Reactのkey・選択照合に使う）。アプリ境界で付与される
}

export interface PageBlock {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutDetectionResult {
  lines: TextRegion[]
  blocks: PageBlock[]
}

export interface OCRResult {
  id: string
  fileName: string
  imageDataUrl: string // サムネイル用（縮小版）
  textBlocks: TextBlock[]
  fullText: string
  processingTimeMs: number
  createdAt: number // Unix timestamp (ms)
  pageBlocks?: PageBlock[] // DEIMが検出した段・カラム境界
  folio?: string // ノンブル（書籍の印刷ページ番号）。OCRで検出できた場合のみ。実験的・不確実
  error?: boolean // 認識に失敗したページのプレースホルダ（textBlocks は空）。画像のみで書き出す
  errorMessage?: string // 失敗理由（スクリーンショットからの原因特定用）
}

export interface ProcessedImage {
  fileName: string
  pageIndex?: number // PDFのページ番号（1始まり）
  imageData: ImageData
  thumbnailDataUrl: string // 表示用縮小版
}

export type OCRStatus =
  | 'idle'
  | 'loading_model'
  | 'processing'
  | 'done'
  | 'error'

export interface OCRJobState {
  status: OCRStatus
  currentFile: string
  currentFileIndex: number
  totalFiles: number
  stageProgress: number // 現在ステージ内の進捗 0.0-1.0
  stage: string
  message: string
  errorMessage?: string
  modelProgress?: { layout: number; rec30: number; rec50: number; rec100: number }
}
