/** @type {import('next').NextConfig} */
// The landing page is the team's Claude Design export (public/landing.html): a self-contained bundle that
// decodes its own scripts, fonts and React into blob: URLs, so it needs a looser CSP than the data pages.
const LANDING_CSP = [
  "default-src 'self' blob: data:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return { beforeFiles: [{ source: '/', destination: '/landing.html' }] }
  },
  // Pages read the indexer on the server, so the browser never connects anywhere but here.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'"
            ].join('; ')
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
        ]
      },
      {
        source: '/landing.html',
        headers: [{ key: 'Content-Security-Policy', value: LANDING_CSP }]
      },
      {
        source: '/',
        headers: [{ key: 'Content-Security-Policy', value: LANDING_CSP }]
      }
    ]
  }
}

export default nextConfig
