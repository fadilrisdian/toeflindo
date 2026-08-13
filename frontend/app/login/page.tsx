'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

export default function LoginPage() {
  const { login } = useAuth()
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const fd = new FormData(e.currentTarget)
      const err = await login(fd.get('username') as string, fd.get('password') as string)
      if (err) { setError(err); setLoading(false) }
      else router.replace('/')
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f6f7f8] px-4">
      {/* brand */}
      <div className="flex items-center gap-2 mb-7">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #2a7a7a, #173f3b)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span className="font-bold text-[#1f2937]">toeflindo</span>
      </div>

      <div className="card p-10 w-full max-w-sm shadow-lg">
        <h1 className="text-lg font-bold text-[#1f2937] mb-1">Welcome back</h1>
        <p className="text-xs text-[#6b7280] mb-6">Sign in to continue to your dashboard</p>

        {error && (
          <div className="mb-4 px-3 py-2 bg-[#fdeaea] border border-[#fca5a5] text-[#dc2626] rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-xs font-semibold text-[#374151] mb-1">
              Username
            </label>
            <input id="username" name="username" type="text" required autoFocus
              className="w-full px-3 py-2.5 border border-[#e6e8eb] rounded-lg text-sm outline-none
                         focus:border-[#2a7a7a] focus:ring-2 focus:ring-[#2a7a7a]/10 transition"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-[#374151] mb-1">
              Password
            </label>
            <input id="password" name="password" type="password" required
              className="w-full px-3 py-2.5 border border-[#e6e8eb] rounded-lg text-sm outline-none
                         focus:border-[#2a7a7a] focus:ring-2 focus:ring-[#2a7a7a]/10 transition"
            />
          </div>
          <button type="submit" disabled={loading}
            className="btn-teal w-full py-2.5 mt-1 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
