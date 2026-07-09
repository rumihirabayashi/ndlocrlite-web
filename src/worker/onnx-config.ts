/**
 * ONNX Runtime Web 設定
 * Web Worker内での統一設定
 *
 * onnxruntime-web/wasm を使用（JSEP/WebGPU不要、CPU専用）
 * Viteの?url importでWASMのハッシュ付きURLを取得し、
 * CDN不要・COEP対応の同一オリジン配信を実現する
 *
 * バージョンは 1.24.3 を使用（1.18固定にはしない）。
 * 1.18ではNDLOCRのDEIMモデルが動かない（検証済み・出力が空になる）ため不可。
 *
 * ただし1.19以降はpthreadビルドのみ同梱されており、初期化時に
 * `WebAssembly.Memory({initial:256, maximum:65536, shared:true})`＝最大4GBの
 * 共有メモリを予約する。iOS 17のWebKitにはページ再読み込み時にこの予約が
 * 解放されないバグがあり（emscripten#19374・onnxruntime#22086、iOS 18で修正済み）、
 * 数回のリロードで「RangeError: Out of memory」→「no available backend found」に
 * 陥る。この対策として clampWasmMemoryForMobile()（下記）で予約上限を下げ、
 * ocr.worker.ts 側でOOMエラー時にタブを閉じて開き直す案内を表示している。
 */

import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

/** clampWasmMemoryForMobile() の二重パッチ防止フラグ（モジュールスコープ） */
let isWasmMemoryClamped = false

/**
 * モバイル（iPad/iPhone/Android）向けにWASMメモリの確保上限をクランプする。
 *
 * onnxruntime-web 1.19以降はデフォルトで maximum:65536 ページ（64KiB×65536＝4GB）の
 * 共有メモリを予約しようとする。iOS 17のWebKitはページ再読み込み時にこの予約を
 * 解放し損ねるバグを抱えており（emscripten#19374・onnxruntime#22086、iOS 18で修正済み）、
 * 数回のリロードでメモリを使い果たし「RangeError: Out of memory」に至る。
 * ここでは `WebAssembly.Memory` をモンキーパッチし、要求された maximum が
 * 20480ページ（64KiB×20480＝1.25GB）を超える場合はそれに切り下げてから
 * 元のコンストラクタを呼び出す。上限を下げることで、予約リークが積み重なった
 * ときの影響と、初期確保そのものの失敗（端末メモリ不足）を減らす狙い。
 */
export function clampWasmMemoryForMobile(): void {
  if (isWasmMemoryClamped) return
  isWasmMemoryClamped = true

  const MAX_PAGES = 20480 // 64KiBページ × 20480 = 1.25GB
  const OriginalMemory = WebAssembly.Memory

  function PatchedMemory(this: unknown, descriptor: WebAssembly.MemoryDescriptor): WebAssembly.Memory {
    if (descriptor.maximum !== undefined && descriptor.maximum > MAX_PAGES) {
      descriptor = { ...descriptor, maximum: MAX_PAGES }
    }
    return new OriginalMemory(descriptor)
  }
  // instanceof WebAssembly.Memory が成立するようプロトタイプを引き継ぐ
  PatchedMemory.prototype = OriginalMemory.prototype

  WebAssembly.Memory = PatchedMemory as unknown as typeof WebAssembly.Memory
}

function initializeONNX() {
  // Viteがバンドルしたハッシュ付きURLを指定（CDN不要・COEP対応）
  ort.env.wasm.wasmPaths = { wasm: wasmUrl }

  // シングルスレッドで安定動作
  ort.env.wasm.numThreads = 1
  ort.env.logLevel = 'warning'

  // Web Worker内ではプロキシワーカー不要
  ort.env.wasm.proxy = false
}

export async function createSession(
  modelData: ArrayBuffer,
  options: Partial<ort.InferenceSession.SessionOptions> = {}
): Promise<ort.InferenceSession> {
  const defaultOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: ['wasm'],
    logSeverityLevel: 4,
    graphOptimizationLevel: 'basic',
    enableCpuMemArena: false,
    enableMemPattern: false,
    ...options,
  }

  try {
    const session = await ort.InferenceSession.create(modelData, defaultOptions)
    return session
  } catch (error) {
    console.error('Failed to create ONNX session:', error)
    throw error
  }
}

initializeONNX()

export { ort }
