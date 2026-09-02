import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发期代理到 FastAPI 后端；构建产物由 FastAPI 静态托管（宝塔只跑一个 Python 进程）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8300', changeOrigin: true },
    },
  },
})
