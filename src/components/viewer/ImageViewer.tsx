import { useRef, useEffect, useState } from 'react'
import type { TextBlock, PageBlock } from '../../types/ocr'

interface ImageViewerProps {
  imageDataUrl: string
  textBlocks: TextBlock[]
  selectedBlock: TextBlock | null
  onBlockSelect: (block: TextBlock) => void
  pageBlocks?: PageBlock[]
  selectedPageBlock?: PageBlock | null
  onPageBlockSelect?: (block: PageBlock) => void
}

export function ImageViewer({
  imageDataUrl,
  textBlocks,
  selectedBlock,
  onBlockSelect,
  pageBlocks,
  selectedPageBlock,
  onPageBlockSelect,
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 })
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const updateSize = () => {
      if (imgRef.current) {
        setImgSize({ width: imgRef.current.clientWidth, height: imgRef.current.clientHeight })
        setNaturalSize({ width: imgRef.current.naturalWidth, height: imgRef.current.naturalHeight })
      }
    }
    const img = imgRef.current
    if (img) {
      img.addEventListener('load', updateSize)
      updateSize()
    }
    // 仕切りドラッグ等でコンテナ幅が変わったときもオーバーレイを追従させる
    const ro = new ResizeObserver(updateSize)
    if (img) ro.observe(img)
    window.addEventListener('resize', updateSize)
    return () => {
      img?.removeEventListener('load', updateSize)
      window.removeEventListener('resize', updateSize)
      ro.disconnect()
    }
  }, [imageDataUrl])

  const scaleX = naturalSize.width > 0 ? imgSize.width / naturalSize.width : 1
  const scaleY = naturalSize.height > 0 ? imgSize.height / naturalSize.height : 1

  return (
    <div className="image-viewer" ref={containerRef}>
      <img
        ref={imgRef}
        src={imageDataUrl}
        alt="OCR対象画像"
        className="viewer-image"
        draggable={false}
      />

      {/* テキスト領域オーバーレイ */}
      <div className="viewer-overlay" style={{ width: imgSize.width, height: imgSize.height }}>
        {/* PageBlock オーバーレイ（段・カラム境界、TextBlock の背面） */}
        {pageBlocks?.map((block, i) => (
          <div
            key={`pb-${i}`}
            className={`page-block-box ${selectedPageBlock === block ? 'selected' : ''}`}
            style={{
              left: block.x * scaleX,
              top: block.y * scaleY,
              width: block.width * scaleX,
              height: block.height * scaleY,
            }}
            onClick={(e) => { e.stopPropagation(); onPageBlockSelect?.(block) }}
            title={`Block ${i + 1}`}
          />
        ))}

        {textBlocks.map((block, i) => (
          <div
            key={i}
            className={`region-box ${selectedBlock === block ? 'selected' : ''}`}
            style={{
              left: block.x * scaleX,
              top: block.y * scaleY,
              width: block.width * scaleX,
              height: block.height * scaleY,
            }}
            onClick={() => onBlockSelect(block)}
            title={block.text}
          />
        ))}
      </div>
    </div>
  )
}
