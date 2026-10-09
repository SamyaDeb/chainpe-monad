export function text(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  }
}

export function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}

export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))
