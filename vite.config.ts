import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// ビルド識別子（gitコミット短縮ハッシュ）。フッターとエラー診断に埋め込み、
// 実機のスクリーンショットからどのビルドが動いているか判別できるようにする
const buildId = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },

  // ONNX Runtime Web: Viteのesbuildプリバンドルを除外（WASMバイナリが壊れるのを防ぐ）
  optimizeDeps: {
    exclude: ['onnxruntime-web', 'onnxruntime-web/wasm'],
  },

  // WASMとONNXファイルをアセットとして認識
  assetsInclude: ['**/*.wasm', '**/*.onnx'],

  build: {
    target: 'esnext',
  },

  // Web WorkerをES moduleフォーマットで出力
  worker: {
    format: 'es',
  },

  // COOP/COEPヘッダーは付けない：numThreads=1でSharedArrayBuffer不使用のため不要。
  // クロスオリジン分離が有効だとONNXランタイムが共有WASMメモリを使い、
  // 旧iOS WebKit（iPadOS 17.3以前等）の共有メモリ成長バグで推論時に失敗する（本番と挙動を揃える）
})
