'use client'

import { useEffect, useRef } from 'react'

/** A slowly rotating dotted sphere (the hero art). Monochrome, canvas, paused for reduced motion. */
export default function Sphere() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const N = 900
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const t = Math.PI * (3 - Math.sqrt(5)) * i
      return { x: Math.cos(t) * r, y, z: Math.sin(t) * r }
    })
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let a = 0.6
    const size = () => {
      const d = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      canvas.width = w * d
      canvas.height = w * d
      ctx.setTransform(d, 0, 0, d, 0, 0)
    }
    const draw = () => {
      const w = canvas.clientWidth
      const R = w * 0.46
      ctx.clearRect(0, 0, w, w)
      const c = Math.cos(a), s = Math.sin(a), tilt = 0.35
      for (const p of pts) {
        const x = p.x * c - p.z * s
        const z0 = p.x * s + p.z * c
        const y = p.y * Math.cos(tilt) - z0 * Math.sin(tilt)
        const z = p.y * Math.sin(tilt) + z0 * Math.cos(tilt)
        const depth = (z + 1) / 2
        ctx.fillStyle = `rgba(17,17,17,${0.08 + depth * 0.5})`
        const sz = 0.6 + depth * 1.8
        ctx.fillRect(w / 2 + x * R - sz / 2, w / 2 + y * R - sz / 2, sz, sz * (1 + depth))
      }
      a += 0.0035
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
