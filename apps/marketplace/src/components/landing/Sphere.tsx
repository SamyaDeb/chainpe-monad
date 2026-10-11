'use client'

import { useEffect, useRef } from 'react'

/**
 * The hero art: a slowly rotating sphere of short ticks arranged in rings around two vortex centres.
 * Monochrome canvas; paused for reduced motion.
 */
export default function Sphere() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const N = 1500
    const centres = [
      [-0.45, -0.55, 0.7],
      [0.55, 0.45, 0.7]
    ].map(([x, y, z]) => {
      const l = Math.hypot(x, y, z)
      return [x / l, y / l, z / l]
    })
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const t = Math.PI * (3 - Math.sqrt(5)) * i
      const p = { x: Math.cos(t) * r, y, z: Math.sin(t) * r, ring: 1, k: 0 }
      let best = 0, bd = 9
      centres.forEach((c, k) => {
        const d = Math.acos(Math.max(-1, Math.min(1, p.x * c[0] + p.y * c[1] + p.z * c[2])))
        if (d < bd) { bd = d; best = k }
      })
      p.k = best
      p.ring = 0.5 + 0.5 * Math.cos(bd * 16) // brighter on rings around the nearest vortex centre
      return p
    })
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let a = 0.4
    const size = () => {
      const d = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      canvas.width = w * d
      canvas.height = w * d
      ctx.setTransform(d, 0, 0, d, 0, 0)
    }
    const rot = (x: number, y: number, z: number): [number, number, number] => {
      const c = Math.cos(a), s = Math.sin(a), tilt = 0.3
      const x1 = x * c - z * s
      const z1 = x * s + z * c
      return [x1, y * Math.cos(tilt) - z1 * Math.sin(tilt), y * Math.sin(tilt) + z1 * Math.cos(tilt)]
    }
    const draw = () => {
      const w = canvas.clientWidth
      const R = w * 0.47
      ctx.clearRect(0, 0, w, w)
      const cs = centres.map(c => rot(c[0], c[1], c[2]))
      for (const p of pts) {
        const [x, y, z] = rot(p.x, p.y, p.z)
        const depth = (z + 1) / 2
        const alpha = (0.05 + depth * 0.5) * (0.35 + p.ring * 0.9)
        if (alpha < 0.03) continue
        const px = w / 2 + x * R, py = w / 2 + y * R
        const c = cs[p.k]
        const ang = Math.atan2(y - c[1], x - c[0]) + Math.PI / 2 // tick runs around the centre
        const len = 2 + depth * 5
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(ang)
        ctx.fillStyle = `rgba(17,17,17,${Math.min(0.7, alpha)})`
        ctx.fillRect(-len / 2, -0.6, len, 1.2 + depth * 0.8)
        ctx.restore()
      }
      a += 0.003
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    size()
    draw()
    window.addEventListener('resize', size)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', size)
    }
  }, [])
  return <canvas ref={ref} className="lp-sphere" aria-hidden="true" />
}
