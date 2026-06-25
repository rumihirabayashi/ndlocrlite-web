/**
 * 見出し付き Word(.docx) エクスポーター
 *
 * NDLOCRのレイアウト分類(classId)を使い、見出し(line_title=16)は見出しスタイル、
 * 本文は段落として書き出す。柱・ノンブル・ルビは除外して読みやすく。
 */
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx'
import type { TextBlock } from '../../types/ocr'

export interface DocxPage {
  fileName: string
  pageLabel?: string
  blocks: TextBlock[]
}

// 除外する種別（柱=8 block_pillar / ノンブル=9 block_folio / ルビ=10 block_rubi）
const SKIP_CLASS_IDS = new Set([8, 9, 10])
// 見出し種別（line_title=16）
const TITLE_CLASS_ID = 16

function endsSentence(s: string): boolean {
  // 文末記号（。．！？!?）で区切る。直後に閉じ括弧が続くのは許容（例：…だ。」）。
  // ただし閉じ括弧「」』）)」単独では区切らない（文中の引用・括弧で改行されるのを防ぐ）。
  return /[。．！？!?][」』）)]*$/.test(s.trim())
}

export interface DocxOptions {
  title?: string
  /** 本文フォント（例：游明朝）。空なら指定せず＝各環境の標準日本語フォント */
  bodyFont?: string
  /** 見出しフォント（例：游ゴシック）。空なら指定なし */
  headingFont?: string
}

// フォント名が空なら font プロパティを付けない（＝環境の既定フォントで崩れを防ぐ）
const fontProp = (f?: string) => (f ? { font: f } : {})

export async function buildDocx(
  pages: DocxPage[],
  options: DocxOptions = {}
): Promise<Blob> {
  const bodyFont = options.bodyFont
  const headingFont = options.headingFont

  const children: Paragraph[] = []
  if (options.title) {
    children.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: options.title, ...fontProp(headingFont) })],
    }))
  }

  // 段落バッファはページを跨いで連結する（ページ境界で文を切らない）
  let para = ''
  const flush = () => {
    // 本文段落は先頭1字下げ（firstLineChars:100 = 1文字分。フォントサイズに依存しない）
    if (para.trim()) {
      children.push(new Paragraph({
        children: [new TextRun({ text: para.trim(), ...fontProp(bodyFont) })],
        indent: { firstLineChars: 100, firstLine: 200 },
      }))
    }
    para = ''
  }

  for (const pg of pages) {
    const blocks = [...pg.blocks].sort((a, b) => a.readingOrder - b.readingOrder)
    for (const b of blocks) {
      const text = b.text.trim()
      if (!text || SKIP_CLASS_IDS.has(b.classId)) continue

      if (b.classId === TITLE_CLASS_ID) {
        flush() // 見出しの前で段落を確定
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text, ...fontProp(headingFont) })],
        }))
        continue
      }

      para += text
      if (endsSentence(text)) flush() // 文末で段落を確定
    }
  }
  flush() // 最後に残りを確定

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun('')] }))
  }

  const doc = new Document({ sections: [{ children }] })
  return await Packer.toBlob(doc)
}
