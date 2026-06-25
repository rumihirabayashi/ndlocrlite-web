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
  return /[。．！？!?」』）)]$/.test(s.trim())
}

export async function buildDocx(
  pages: DocxPage[],
  options: { title?: string } = {}
): Promise<Blob> {
  const children: Paragraph[] = []
  if (options.title) {
    children.push(new Paragraph({ text: options.title, heading: HeadingLevel.TITLE }))
  }


  // 段落バッファはページを跨いで連結する（ページ境界で文を切らない）
  let para = ''
  const flush = () => {
    // 本文段落は先頭1字下げ（firstLineChars:100 = 1文字分。フォントサイズに依存しない）
    if (para.trim()) {
      children.push(new Paragraph({
        children: [new TextRun(para.trim())],
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
        children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }))
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
