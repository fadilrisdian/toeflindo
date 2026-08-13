'use client'

import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <h2 className="text-lg font-bold text-red-600 mb-2">Dashboard failed to load</h2>
      <p className="text-sm text-[#6b7280] mb-2">{error.message || 'Unknown error'}</p>
      {error.stack && (
        <pre className="text-xs text-left bg-[#f9fafb] border rounded p-3 mb-4 overflow-auto max-h-48">
          {error.stack}
        </pre>
      )}
      <button onClick={reset} className="btn-teal px-5">Try again</button>
    </div>
  )
}
