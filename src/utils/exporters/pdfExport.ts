/**
 * 透明テキスト付きPDF（検索可能・読み上げ可能PDF）エクスポーター
 *
 * - 各ページ＝元画像を全面に描画し、その上に「不可視テキスト層」を読み順で重ねる。
 * - 1行＝1テキストとして配置（縦書きは90°回転）。これにより
 *   ・コピー/検索で連続した文字列になる（1文字ずつにならない）
 *   ・重複した同一文字が統合されて欠ける不具合が起きない
 *   ・PDFKit(Preview/VoiceOver/iOS)が正しい順（右列→左列）で読む
 * - 日本語フォント(Noto Sans JP)をサブセット埋め込みし、検索・コピー・読み上げを可能にする。
 * - ページ画像はJPEGで埋め込む（PNGに比べメモリ・処理時間・ファイルサイズを大幅削減でき、
 *   モバイル端末でのPDF書き出し失敗＝メモリ/CPU負荷対策になる）。ブラウザがJPEG生成に非対応で
 *   PNGを返した場合はPNGとして埋め込む（呼び出し側が imageMime で申告）。
 */
import { PDFDocument, rgb, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { TextBlock } from '../../types/ocr'
import notoFontUrl from '../../assets/fonts/NotoSansJP-Regular.otf'

export type Orientation = 'auto' | 'vertical' | 'horizontal'

export interface ExportPage {
  /** ページ画像のバイト列（JPEGまたはPNG。imageMime で判別） */
  imageBytes: Uint8Array
  /** imageBytes の実際の形式。JPEG生成に非対応の環境ではPNGが渡ってくる */
  imageMime: 'image/jpeg' | 'image/png'
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
  options: { orientation?: Orientation; naturalReaderMode?: boolean } = {}
): Promise<Uint8Array> {
  const orientation = options.orientation ?? 'auto'
  const naturalReaderMode = options.naturalReaderMode ?? false
  const pdfDoc = await PDFDocument.create()
  pdfDoc.registerFontkit(fontkit)
  const font = await pdfDoc.embedFont(await loadFontBytes(), { subset: true })

  // 不可視テキスト（opacity 0）。PDFKit等は本文として抽出・読み上げ可能。
  const invisible = { opacity: 0, color: rgb(0, 0, 0) }

  for (const page of pages) {
    const img = page.imageMime === 'image/jpeg'
      ? await pdfDoc.embedJpg(page.imageBytes)
      : await pdfDoc.embedPng(page.imageBytes)
    const W = page.width
    const H = page.height
    const pg = pdfDoc.addPage([W, H])
    pg.drawImage(img, { x: 0, y: 0, width: W, height: H })

    if (naturalReaderMode) {
      // NaturalReader対応（実験）：回転テキストを使わず、不可視テキストを
      // 「横書き・読み順で上から下へスタック」して重ねる。
      // 検証で、NaturalReader等の横書き前提リーダーは回転（縦書き）の孤立見出し列を
      // 取りこぼすが、横書き読み順スタックなら見出し含め全文を正しい順で読むと判明。
      // page.blocks は読み順に並んでいる前提。テキストは透明なので見た目には影響しない。
      const lines = page.blocks
        .map(b => (b.text ?? '').replace(/\s+$/g, ''))
        .filter(t => t.length > 0)
      const n = lines.length
      if (n > 0) {
        const margin = Math.max(20, H * 0.02)
        const maxChars = Math.max(...lines.map(t => Array.from(t).length), 1)
        // 横幅・縦高の両方に収まる文字サイズ（CJKは1文字≒1em幅で概算）
        const fitW = ((W - margin * 2) / maxChars) * 0.95
        const fitH = ((H - margin * 2) / n) * 0.8
        const size = Math.max(6, Math.min(fitW, fitH))
        const lineH = (H - margin * 2) / n
        let y = H - margin - size
        for (const text of lines) {
          drawTextSafe(pg, font, text, margin, y, size, degrees(0), invisible)
          y -= lineH
        }
      }
    } else {
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
