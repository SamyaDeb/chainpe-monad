'use client'

import { useEffect, useState } from 'react'

const WORDS = ['settle', 'pay', 'rate'] as const

/** The hero verb: "The layer to settle / pay / rate". With reduced motion it changes without sliding. */
export default function Rotator() {
  const [i, setI] = useState(0)
  const [show, setShow] = useState(true)
  useEffect(() => {
    const t = setInterval(() => {
      setShow(false)
      setTimeout(() => {
        setI(v => (v + 1) % WORDS.length)
        setShow(true)
      }, 320)
    }, 3200)
    return () => clearInterval(t)
  }, [])
  return <u className={`lp-rot${show ? '' : ' out'}`}>{WORDS[i]}</u>
}
