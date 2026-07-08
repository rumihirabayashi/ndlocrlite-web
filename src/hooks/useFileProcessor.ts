import { useState, useCallback } from 'react'
import type { ProcessedImage } from '../types/ocr'
import { fileToProcessedImage, tiffToProcessedImages, isTiffFile, isHeicFile } from '../utils/imageLoader'
import { pdfToProcessedImages } from '../utils/pdfLoader'

export interface FileLoadingState {
  fileName: string
  currentPage: number | null
  totalPages: number | null
}

export function useFileProcessor() {
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileLoadingState, setFileLoadingState] = useState<FileLoadingState | null>(null)

  const processFiles = useCallback(async (files: File[]) => {
    setIsLoading(true)
    setError(null)

    const images: ProcessedImage[] = []
    // ファイルごとにtry/catchする：1ファイルの失敗が他の成功分の表示を止めないようにする
    const failures: string[] = []

    try {
      for (const file of files) {
        try {
          if (file.type === 'application/pdf') {
            setFileLoadingState({ fileName: file.name, currentPage: null, totalPages: null })
            const pages = await pdfToProcessedImages(file, 2.0, (current, total) => {
              setFileLoadingState({ fileName: file.name, currentPage: current, totalPages: total })
            })
            images.push(...pages)
          } else if (isTiffFile(file)) {
            setFileLoadingState({ fileName: file.name, currentPage: null, totalPages: null })
            const pages = await tiffToProcessedImages(file)
            images.push(...pages)
          } else if (file.type.startsWith('image/') || isHeicFile(file)) {
            setFileLoadingState({ fileName: file.name, currentPage: null, totalPages: null })
            const img = await fileToProcessedImage(file)
            images.push(img)
          } else {
            // どの分岐にも該当しない（拡張子・MIMEが未対応）
            failures.push(`失敗: ${file.name}（未対応の形式）`)
          }
        } catch (err) {
          failures.push(`失敗: ${file.name}（${(err as Error).message}）`)
        }
      }
      setProcessedImages(images)
      if (failures.length > 0) setError(failures.join('\n'))
    } finally {
      setIsLoading(false)
      setFileLoadingState(null)
    }
  }, [])

  const clearImages = useCallback(() => {
    setProcessedImages([])
    setError(null)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { processedImages, isLoading, error, processFiles, clearImages, clearError, fileLoadingState, restoreImages: setProcessedImages }
}
