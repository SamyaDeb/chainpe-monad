'use client'

import { useEffect, useRef } from 'react'

type P = { x: number; y: number; z: number; phi: number; k: number; ring: number }

/**
 * The hero art: a rotating sphere of short ticks laid out in concentric rings around two vortex
 * centres (the design's "circle"). Monochrome canvas. With reduced motion it still turns, only slower
 * and gently, because the motion is the point of the piece and it never flashes or jumps.
 */
export default function Sphere() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const unit = (v: number[]) => {
      const l = Math.hypot(v[0], v[1], v[2])
      return [v[0] / l, v[1] / l, v[2] / l]
    }
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const centres = [unit([-0.5, -0.55, 0.67]), unit([0.55, 0.5, 0.66])]

    // concentric rings of ticks around each centre; each point belongs to its nearest centre
    const pts: P[] = []
    const STEP = 0.062 // arc spacing between ticks, radians
    centres.forEach((c, k) => {
      const ref0 = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
      const u = unit(cross(c, ref0))
      const v = cross(c, u)
      for (let th = 0.085; th < Math.PI; th += 0.085) {
        const n = Math.max(6, Math.round((2 * Math.PI * Math.sin(th)) / STEP))
        for (let i = 0; i < n; i++) {
          const phi = (i / n) * 2 * Math.PI + th * 3 // slight spiral so it reads as a vortex
          const s = Math.sin(th), co = Math.cos(th)
          const p = [
            c[0] * co + s * (u[0] * Math.cos(phi) + v[0] * Math.sin(phi)),
            c[1] * co + s * (u[1] * Math.cos(phi) + v[1] * Math.sin(phi)),
            c[2] * co + s * (u[2] * Math.cos(phi) + v[2] * Math.sin(phi))
          ]
          const other = centres[1 - k]
          const dOther = p[0] * other[0] + p[1] * other[1] + p[2] * other[2]
          const dThis = p[0] * c[0] + p[1] * c[1] + p[2] * c[2]
          if (dOther > dThis) continue // closer to the other centre
          pts.push({ x: p[0], y: p[1], z: p[2], phi, k, ring: th })
        }
      }
    })

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const speed = reduce ? 0.0009 : 0.0032
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
      const c = Math.cos(a), s = Math.sin(a), tilt = 0.28
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
        if (z < -0.15) continue // far side stays hidden: the sphere reads as a solid
        const depth = (z + 1) / 2
        const ringBeat = 0.55 + 0.45 * Math.cos(p.ring * 22) // visible banding between rings
        const alpha = (0.1 + depth * 0.62) * ringBeat
        if (alpha < 0.05) continue
        const px = w / 2 + x * R, py = w / 2 + y * R
        const c = cs[p.k]
        const ang = Math.atan2(y - c[1], x - c[0]) + Math.PI / 2 // each tick runs around its centre
        const len = 2.2 + depth * 5.2
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(ang)
        ctx.fillStyle = `rgba(17,17,17,${Math.min(0.78, alpha)})`
        ctx.fillRect(-len / 2, -0.7, len, 1.3 + depth * 1.1)
        ctx.restore()
      }
      a += speed
      raf = requestAnimationFrame(draw)
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
