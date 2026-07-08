/**
 * 画像ファイル → ImageData + サムネイルDataUrl 変換
 */

import UTIF from 'utif'
import type { ProcessedImage } from '../types/ocr'

const THUMBNAIL_MAX_WIDTH = 200

/**
 * 読み込み画像の解像度上限（画素数）。
 * iOS SafariはCanvasの面積が約16,777,216画素（4096×4096相当）を超えると、
 * 例外を出さずに黙って描画・取得に失敗する（スキャン書籍の300〜600dpi画像は容易に超える）。
 * そのため安全マージンを見て12,000,000画素に制限する。
 * OCRのレイアウト検出は1024×1024・行認識のcropは高さ24px固定で処理するため、
 * 12MP程度に縮小しても認識品質への影響は小さい。
 */
export const MAX_PIXELS = 12_000_000

export function isTiffFile(file: File): boolean {
  if (file.type === 'image/tiff') return true
  const ext = file.name.toLowerCase().split('.').pop()
  return ext === 'tiff' || ext === 'tif'
}

export function isHeicFile(file: File): boolean {
  if (file.type === 'image/heic' || file.type === 'image/heif') return true
  const ext = file.name.toLowerCase().split('.').pop()
  return ext === 'heic' || ext === 'heif'
}

export async function fileToProcessedImage(file: File): Promise<ProcessedImage> {
  const imageData = await fileToImageData(file)
  const thumbnailDataUrl = makeThumbnailDataUrl(imageData)

  return {
    fileName: file.name,
    imageData,
    thumbnailDataUrl,
  }
}

/** TIFF ファイル（複数ページ対応）→ ProcessedImage[] */
export async function tiffToProcessedImages(file: File): Promise<ProcessedImage[]> {
  const buffer = await file.arrayBuffer()
  const ifds = UTIF.decode(buffer)
  const results: ProcessedImage[] = []

  for (let i = 0; i < ifds.length; i++) {
    UTIF.decodeImage(buffer, ifds[i])
    const w = ifds[i].width
    const h = ifds[i].height
    const rgba = UTIF.toRGBA8(ifds[i])
    // 12MP超はここで縮小する。canvas経由で縮小するとフルサイズのcanvasが一旦必要になり
    // iOS Safariの上限に引っかかるため、canvasを使わない純JSのボックスサンプリングで縮小する。
    const imageData = downscaleImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), MAX_PIXELS)
    const thumbnailDataUrl = makeThumbnailDataUrl(imageData)
    results.push({
      fileName: file.name,
      pageIndex: ifds.length > 1 ? i + 1 : undefined,
      imageData,
      thumbnailDataUrl,
    })
  }

  return results
}

async function fileToImageData(file: File): Promise<ImageData> {
  if (isHeicFile(file)) return heicFileToImageData(file)
  return standardImageToImageData(file)
}

async function heicFileToImageData(file: File): Promise<ImageData> {
  // heic2any は重いため動的インポート（初回HEIC処理時のみ読み込み）
  const { default: heic2any } = await import('heic2any')
  const result = await heic2any({ blob: file, toType: 'image/png' })
  const pngBlob = Array.isArray(result) ? result[0] : result
  return blobToImageData(pngBlob, file.name)
}

async function blobToImageData(blob: Blob, name: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      // canvasはMAX_PIXELS以下になるよう縮小サイズで作る（フルサイズのcanvasは絶対に作らない。
      // imgオブジェクト自体が大きいのは問題ない＝縮小描画するだけ）
      const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (img.width * img.height)))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(ctx.getImageData(0, 0, w, h))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Failed to load image: ${name}`))
    }
    img.src = url
  })
}

async function standardImageToImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      // canvasはMAX_PIXELS以下になるよう縮小サイズで作る（フルサイズのcanvasは絶対に作らない。
      // imgオブジェクト自体が大きいのは問題ない＝縮小描画するだけ）
      const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (img.width * img.height)))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(ctx.getImageData(0, 0, w, h))
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Failed to load image: ${file.name}`))
    }

    img.src = url
  })
}

/**
 * ImageDataを純JSのボックスサンプリングで縮小する（canvasを使わない）。
 * TIFFはUTIFでcanvasを経由せず直接RGBA配列が得られるため、ここで縮小しないと
 * 後段（makeThumbnailDataUrl等）でフルサイズのcanvasが必要になりiOSで黙って失敗する。
 * maxPixels以下ならそのまま返す。
 */
export function downscaleImageData(imageData: ImageData, maxPixels: number): ImageData {
  const { width, height, data } = imageData
  if (width * height <= maxPixels) return imageData

  const scale = Math.sqrt(maxPixels / (width * height))
  const newW = Math.max(1, Math.round(width * scale))
  const newH = Math.max(1, Math.round(height * scale))
  const dst = new Uint8ClampedArray(newW * newH * 4)

  // 出力ピクセルごとに、対応する元画像の矩形範囲（ボックス）内のRGBAを平均する
  for (let dy = 0; dy < newH; dy++) {
    const sy0 = Math.floor((dy * height) / newH)
    const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * height) / newH))
    for (let dx = 0; dx < newW; dx++) {
      const sx0 = Math.floor((dx * width) / newW)
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * width) / newW))

      let r = 0, g = 0, b = 0, a = 0, count = 0
      for (let sy = sy0; sy < sy1; sy++) {
        let offset = (sy * width + sx0) * 4
        for (let sx = sx0; sx < sx1; sx++) {
          r += data[offset]
          g += data[offset + 1]
          b += data[offset + 2]
          a += data[offset + 3]
          offset += 4
          count++
        }
      }

      const dstOffset = (dy * newW + dx) * 4
      dst[dstOffset] = r / count
      dst[dstOffset + 1] = g / count
      dst[dstOffset + 2] = b / count
      dst[dstOffset + 3] = a / count
    }
  }

  return new ImageData(dst, newW, newH)
}

// 前提：ここに渡るimageDataは呼び出し元（fileToImageData / tiffToProcessedImages / pdfToProcessedImages）
// で既にMAX_PIXELS以下に縮小済み。そのためsrcCanvasをフルサイズで作ってもiOSのcanvas上限を超えない。
export function makeThumbnailDataUrl(imageData: ImageData): string {
  const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / imageData.width)
  const w = Math.round(imageData.width * scale)
  const h = Math.round(imageData.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  // ImageData → 元サイズキャンバス → 縮小キャンバス
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = imageData.width
  srcCanvas.height = imageData.height
  srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0)
  ctx.drawImage(srcCanvas, 0, 0, w, h)

  return canvas.toDataURL('image/jpeg', 0.7)
}

export function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  canvas.getContext('2d')!.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85)
}
