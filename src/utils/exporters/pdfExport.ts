/**
 * 透明テキスト付きPDF（検索可能・読み上げ可能PDF）エクスポーター
 *
 * - 各ページ＝元画像を全面に描画し、その上に「不可視テキスト層」を読み順で重ねる。
 * - 縦書きは1文字ずつ縦に配置（PDFKit＝Preview/VoiceOver/iOSが正しい順で読む）。
 * - 日本語フォント(Noto Sans JP)をサブセット埋め込みし、検索・コピー・読み上げを可能にする。
 *
 * 参考：本家NDLOCR-Lite(reportlab)の透明テキスト層を、ブラウザ(pdf-lib)で再現したもの。
 */
import { PDFDocument, rgb } from 'pdf-lib'
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
      const chars = Array.from(text)

      if (isVerticalLine(block, orientation)) {
        // 縦書き：列幅 ≈ 1文字サイズ。上から下へ1文字ずつ配置。
        const size = Math.max(6, Math.min(block.width, block.height / chars.length) * 1.05)
        const step = block.height / chars.length
        const x = block.x + (block.width - size) / 2
        for (let i = 0; i < chars.length; i++) {
          const yTop = block.y + i * step
          drawCharSafe(pg, font, chars[i], x, H - yTop - size, size, invisible)
        }
      } else {
        // 横書き：行をまとめて1回で配置。
        const size = Math.max(6, block.height * 0.9)
        drawCharSafe(pg, font, text, block.x, H - block.y - block.height + (block.height - size) / 2, size, invisible)
      }
    }
  }

  return await pdfDoc.save()
}

/** 1グリフ／文字列を描画。フォントに無い文字でも例外で全体が落ちないようガード。 */
function drawCharSafe(
  pg: import('pdf-lib').PDFPage,
  font: import('pdf-lib').PDFFont,
  text: string,
  x: number,
  y: number,
  size: number,
  style: { opacity: number; color: ReturnType<typeof rgb> }
): void {
  try {
    pg.drawText(text, { x, y, size, font, opacity: style.opacity, color: style.color })
  } catch {
    /* 埋め込み不可の文字はスキップ（読み上げ順への影響は軽微） */
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
