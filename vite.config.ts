import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vitePluginScopedCSS from './src/plugins/vite-plugin-scoped-css/index.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vitePluginScopedCSS(), react()],
})
