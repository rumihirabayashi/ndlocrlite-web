/**
 * ePub エクスポーター（リフロー・読み上げ向け）
 *
 * 読み順整序済みのテキストを、見出し(line_title=16)で章に区切ってePub(.epub)へ。
 * 見出しがそのまま目次(nav)になり、本文はページを跨いで段落連結する。
 * 柱・ノンブル・ルビは除外。レイアウト重視は透明テキストPDFを使う。
 */
import JSZip from 'jszip'
import type { TextBlock } from '../../types/ocr'

export interface EpubPage {
  fileName: string
  pageLabel?: string
  blocks: TextBlock[]
}

// 除外（柱=8 / ノンブル=9 / ルビ=10）／見出し（line_title=16）
const SKIP_CLASS_IDS = new Set([8, 9, 10])
const TITLE_CLASS_ID = 16

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const endsSentence = (s: string) => /[。．！？!?」』）)]$/.test(s.trim())

interface Chapter { title: string; paragraphs: string[]; fromHeading: boolean }

// 全ページの行を読み順に流し、見出しで章に分割する
function buildChapters(pages: EpubPage[], defaultTitle: string): Chapter[] {
  const chapters: Chapter[] = []
  let cur: Chapter = { title: defaultTitle, paragraphs: [], fromHeading: false }
  let para = ''
  const flushPara = () => { if (para.trim()) cur.paragraphs.push(para.trim()); para = '' }
  const startChapter = (title: string, fromHeading: boolean) => {
    flushPara()
    chapters.push(cur)
    cur = { title, paragraphs: [], fromHeading }
  }

  for (const pg of pages) {
    const blocks = [...pg.blocks].sort((a, b) => a.readingOrder - b.readingOrder)
    for (const b of blocks) {
      const t = b.text.trim()
      if (!t || SKIP_CLASS_IDS.has(b.classId)) continue
      if (b.classId === TITLE_CLASS_ID) {
        startChapter(t, true)
      } else {
        para += t
        if (endsSentence(t)) flushPara()
      }
    }
  }
  flushPara()
  chapters.push(cur)

  // 見出し章は中身が空でも残す（見出しのみの章）。冒頭の仮章は本文があるときだけ残す。
  return chapters.filter(c => c.fromHeading || c.paragraphs.length > 0)
}

export async function buildEpub(
  pages: EpubPage[],
  options: { title?: string } = {}
): Promise<Blob> {
  const title = options.title ?? 'OCR結果'
  const chapters = buildChapters(pages, title)
  const zip = new JSZip()

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  zip.file('META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)

  zip.file('OEBPS/style.css',
    `body { font-family: serif; line-height: 1.8; margin: 1em; }
h2 { font-size: 1.15em; margin: 1.2em 0 0.6em; }
p { margin: 0; text-indent: 1em; }`)

  const items = chapters.map((c, i) => {
    const heading = c.fromHeading ? `    <h2>${esc(c.title)}</h2>\n` : ''
    const body = c.paragraphs.map(p => `    <p>${esc(p)}</p>`).join('\n')
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja" lang="ja">
  <head><meta charset="utf-8"/><title>${esc(c.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/></head>
  <body>
${heading}${body}
  </body>
</html>`
    const href = `chap${i + 1}.xhtml`
    zip.file(`OEBPS/${href}`, xhtml)
    return { id: `chap${i + 1}`, href, title: c.title }
  })

  const manifestItems = items
    .map(c => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spineItems = items.map(c => `    <itemref idref="${c.id}"/>`).join('\n')
  const navList = items
    .map(c => `      <li><a href="${c.href}">${esc(c.title)}</a></li>`)
    .join('\n')

  zip.file('OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ja">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:ndlocr-${Date.now()}-${chapters.length}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`)

  zip.file('OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
  <head><meta charset="utf-8"/><title>目次</title></head>
  <body>
    <nav epub:type="toc" id="toc"><h1>目次</h1><ol>
${navList}
    </ol></nav>
  </body>
</html>`)

  return await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
