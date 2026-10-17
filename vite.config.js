import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function canvasProxy() {
  return {
    name: 'canvas-proxy',
    configureServer(server) {
      server.middlewares.use('/api/canvas', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Use GET' }))
          return
        }

        try {
          const base = String(req.headers['x-canvas-base'] || '')
          const auth = String(req.headers.authorization || '')
          if (!base || !auth.startsWith('Bearer ')) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Add a Canvas URL and access token.' }))
            return
          }

          let target
          try {
            target = new URL(base)
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'That Canvas URL is not valid.' }))
            return
          }
          if (target.protocol !== 'https:') {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Canvas URL needs to start with https.' }))
            return
          }

          const incoming = new URL(req.url, 'http://localhost')
          const path = incoming.searchParams.get('path') || ''
          if (!/^\/api\/v1\/[a-zA-Z0-9_./%-]+$/.test(path)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Only Canvas API paths can be requested.' }))
            return
          }

          const dest = new URL(path, target.origin)
          incoming.searchParams.forEach((value, key) => {
            if (key !== 'path') dest.searchParams.append(key, value)
          })

          const pages = []
          let nextUrl = dest.toString()
          for (let page = 0; page < 6 && nextUrl; page += 1) {
            const canvasRes = await fetch(nextUrl, {
              headers: { Authorization: auth, Accept: 'application/json' },
            })
            const text = await canvasRes.text()
            if (!canvasRes.ok) {
              res.statusCode = canvasRes.status
              res.setHeader('Content-Type', 'application/json')
              res.end(text || JSON.stringify({ error: 'Canvas rejected the request.' }))
              return
            }
            const data = JSON.parse(text)
            if (!Array.isArray(data)) {
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(text)
              return
            }
            pages.push(...data)
            const link = canvasRes.headers.get('link') || ''
            const match = link
              .split(',')
              .map((part) => part.trim())
              .find((part) => part.endsWith('rel="next"'))
            const next = match?.match(/<([^>]+)>/)?.[1]
            if (!next) break
            const nextHost = new URL(next)
            if (nextHost.origin !== target.origin) break
            nextUrl = next
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(pages))
        } catch (error) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: error.message || 'Could not reach Canvas.' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), canvasProxy()],
  server: { port: 5173 },
})
