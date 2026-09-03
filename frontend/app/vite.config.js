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
  build: {
    rollupOptions: {
      output: {
        // 大体积三方库单独拆包：并行下载 + 与业务代码分开缓存，避免发版后全量重新下载
        // （rolldown-vite 仅支持函数形式）
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@ant-design/pro-')) return 'pro'
          if (id.includes('antd') || id.includes('@ant-design/') || id.includes('rc-')) return 'antd'
          if (id.includes('react')) return 'react'
          return undefined
        },
      },
    },
  },
})
