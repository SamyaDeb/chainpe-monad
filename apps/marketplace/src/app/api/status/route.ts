import { getLiveStatus } from '@/lib/status'

// Same-origin status for the landing page's "Network Status" rows (health of the hosted services).
export const revalidate = 60

export async function GET() {
  return Response.json(await getLiveStatus(), { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } })
}
