import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base를 상대 경로로 두어 GitHub Pages의 /저장소이름/ 아래에서도 그대로 동작한다.
export default defineConfig({
  base: './',
  plugins: [react()],
})
