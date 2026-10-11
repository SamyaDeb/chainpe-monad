'use client'

import { useEffect, useRef, useState } from 'react'

/** Counts from 0 to `to` when scrolled into view (instant for reduced motion). */
export default function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [v, setV] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const run = () => {
      if (reduce) return setV(to)
      const t0 = performance.now()
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 1200)
        setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
        if (k < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) {
        io.disconnect()
        run()
      }
    })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [to])
  return <span ref={ref}>{v}{suffix}</span>
}
