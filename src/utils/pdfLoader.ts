/**
 * pdfjs-dist を使用したPDF → ImageData 変換
 */

import type { ProcessedImage } from '../types/ocr'
import { makeThumbnailDataUrl, MAX_PIXELS } from './imageLoader'
// legacyビルドを使う：通常ビルドはPromise.withResolvers等の新API前提でSafari 17.4未満
// （iPadOS 17.0〜17.3等）だと読み込み時に失敗する。legacyはpolyfill同梱
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

let pdfjsLib: typeof import('pdfjs-dist') | null = null

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist')
    // Viteがバンドルしたハッシュ付きURLを使用（CDN不要・COEP対応）
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
  }
  return pdfjsLib
}

export async function pdfToProcessedImages(
  file: File,
  scale = 2.0,
  onProgress?: (current: number, total: number) => void
): Promise<ProcessedImage[]> {
  const pdfjs = await getPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const totalPages = pdf.numPages

  const images: ProcessedImage[] = []

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (onProgress) onProgress(pageNum, totalPages)

    const page = await pdf.getPage(pageNum)
    // iOS Safariのcanvas面積上限（約16.7M画素）を安全マージン込みで超えないよう、
    // 指定scaleでの面積がMAX_PIXELSを超える場合はscaleを縮小する（高dpiスキャンPDF対策）
    const viewport1 = page.getViewport({ scale: 1 })
    const effectiveScale = Math.min(scale, Math.sqrt(MAX_PIXELS / (viewport1.width * viewport1.height)))
    const viewport = page.getViewport({ scale: effectiveScale })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!

    await page.render({ canvasContext: ctx, viewport }).promise

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const thumbnailDataUrl = makeThumbnailDataUrl(imageData)

    images.push({
      fileName: file.name,
      pageIndex: pageNum,
      imageData,
      thumbnailDataUrl,
    })
  }

  return images
}
