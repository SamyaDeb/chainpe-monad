import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="container" style={{ padding: '64px 20px' }}>
      <h1>Not found</h1>
      <p>
        <Link href="/">Home</Link> · <Link href="/services">Services</Link>
      </p>
    </div>
  )
}
