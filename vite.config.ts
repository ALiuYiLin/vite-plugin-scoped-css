import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vitePluginScopedCSS from 'vite-plugin-scoped-css'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vitePluginScopedCSS(), react()],
})
