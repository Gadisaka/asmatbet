import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true,
        },
        "/socket.io": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true,
          ws: true,
        },
      },
    },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
})
