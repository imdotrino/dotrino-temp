import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import prerender from '@dotrino/prerender/vite'
import pkg from './package.json' with { type: 'json' }

// <meta name="commit"> con el hash del commit del build (CONVENCIONES-APPS §3).
function commitMeta () {
  let hash = 'dev'
  try { hash = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* sin git */ }
  return {
    name: 'commit-meta',
    transformIndexHtml: (html) =>
      html.replace('</head>', `  <meta name="commit" content="${hash}" />
  </head>`),
  }
}

// El canal va en la ruta (efimeral.dotrino.com/abc). Pages no sabe de rutas: lo que no
// existe lo sirve su 404.html, así que el 404 es la misma app.
function spaFallback () {
  return {
    name: 'spa-404',
    closeBundle () {
      const dist = resolve(import.meta.dirname, 'dist')
      copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'))
    },
  }
}

export default defineConfig({
  plugins: [prerender(), commitMeta(), spaFallback()],
  // base '/' y no './': la app se sirve también desde /abc, y ahí una ruta relativa
  // buscaría los assets en el sitio equivocado.
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 3290, host: true },
})
