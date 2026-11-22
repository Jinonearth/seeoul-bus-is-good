import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages에 올릴 때는 BASE_PATH=/저장소이름/ 으로 빌드
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
