import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google'
import './landing.css'

const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--lp-serif' })
const sans = Instrument_Sans({ subsets: ['latin'], variable: '--lp-sans' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--lp-mono' })

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`lp ${serif.variable} ${sans.variable} ${mono.variable}`}>{children}</div>
}
