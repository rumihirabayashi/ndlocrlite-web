/**
 * 透明テキスト付きPDF（検索可能・読み上げ可能PDF）エクスポーター
 *
 * - 各ページ＝元画像を全面に描画し、その上に「不可視テキスト層」を読み順で重ねる。
 * - 1行＝1テキストとして配置（縦書きは90°回転）。これにより
 *   ・コピー/検索で連続した文字列になる（1文字ずつにならない）
 *   ・重複した同一文字が統合されて欠ける不具合が起きない
 *   ・PDFKit(Preview/VoiceOver/iOS)が正しい順（右列→左列）で読む
 * - 日本語フォント(Noto Sans JP)をサブセット埋め込みし、検索・コピー・読み上げを可能にする。
 */
import { PDFDocument, rgb, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { TextBlock } from '../../types/ocr'
import notoFontUrl from '../../assets/fonts/NotoSansJP-Regular.otf'

export type Orientation = 'auto' | 'vertical' | 'horizontal'

export interface ExportPage {
  /** ページ画像（PNG）のバイト列 */
  pngBytes: Uint8Array
  /** 画像の幅・高さ（px）。textBlocks の座標系と一致していること */
  width: number
  height: number
  /** 読み順整序済みのテキスト行 */
  blocks: TextBlock[]
}

/** 行が縦書きか判定（auto時はアスペクト比、それ以外は指定に従う） */
function isVerticalLine(b: TextBlock, orientation: Orientation): boolean {
  if (orientation === 'vertical') return true
  if (orientation === 'horizontal') return false
  return b.height > b.width // auto: 縦長＝縦書き
}

let cachedFontBytes: ArrayBuffer | null = null
async function loadFontBytes(): Promise<ArrayBuffer> {
  if (!cachedFontBytes) {
    cachedFontBytes = await (await fetch(notoFontUrl)).arrayBuffer()
  }
  return cachedFontBytes
}

/**
 * 透明テキスト付きPDFを生成して Uint8Array(PDFバイト列) を返す。
 */
export async function buildSearchablePdf(
  pages: ExportPage[],
  options: { orientation?: Orientation } = {}
): Promise<Uint8Array> {
  const orientation = options.orientation ?? 'auto'
  const pdfDoc = await PDFDocument.create()
  pdfDoc.registerFontkit(fontkit)
  const font = await pdfDoc.embedFont(await loadFontBytes(), { subset: true })

  // 不可視テキスト（opacity 0）。PDFKit等は本文として抽出・読み上げ可能。
  const invisible = { opacity: 0, color: rgb(0, 0, 0) }

  for (const page of pages) {
    const img = await pdfDoc.embedPng(page.pngBytes)
    const W = page.width
    const H = page.height
    const pg = pdfDoc.addPage([W, H])
    pg.drawImage(img, { x: 0, y: 0, width: W, height: H })

    for (const block of page.blocks) {
      const text = (block.text ?? '').replace(/\s+$/g, '')
      if (!text) continue
      const charCount = Array.from(text).length

      if (isVerticalLine(block, orientation)) {
        // 縦書き：行全体を1テキストとして、列の位置に90°回転で配置（不可視）。
        // 文字数で1文字サイズを見積もり、列内に収まるようにする。
        const size = Math.max(6, Math.min(block.width, block.height / charCount))
        drawTextSafe(pg, font, text, block.x + size * 0.9, H - block.y, size, degrees(-90), invisible)
      } else {
        // 横書き：行をまとめて1回で配置。
        const size = Math.max(6, block.height * 0.9)
        drawTextSafe(pg, font, text, block.x, H - block.y - block.height + (block.height - size) / 2, size, degrees(0), invisible)
      }
    }
  }

  return await pdfDoc.save()
}

/** 1行のテキストを描画（縦書きは回転）。フォントに無い文字でも例外で全体が落ちないようガード。 */
function drawTextSafe(
  pg: import('pdf-lib').PDFPage,
  font: import('pdf-lib').PDFFont,
  text: string,
  x: number,
  y: number,
  size: number,
  rotate: ReturnType<typeof degrees>,
  style: { opacity: number; color: ReturnType<typeof rgb> }
): void {
  try {
    pg.drawText(text, { x, y, size, font, rotate, opacity: style.opacity, color: style.color })
  } catch {
    /* 埋め込み不可の文字を含む行はスキップ（影響は軽微） */
  }
}

/** ブラウザでダウンロードさせる */
export function downloadPdf(bytes: Uint8Array, baseName: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}_検索可能.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
