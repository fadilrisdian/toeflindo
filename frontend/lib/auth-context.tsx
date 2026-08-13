'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'

interface AuthContextType {
  user: string | null
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]   = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  // Restore session on mount by verifying the httpOnly cookie with the server.
  // We never store the token in localStorage — the cookie is the source of truth.
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.username) setUser(data.username)
        else { setToken(null); setUser(null) }
      })
      .catch(() => { setToken(null); setUser(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    try {
      const fd = new FormData()
      fd.append('username', username)
      fd.append('password', password)
      // credentials:'include' ensures the httpOnly cookie set by the server is stored
      const res = await fetch('/api/auth/login', { method: 'POST', body: fd, credentials: 'include' })
      if (!res.ok) return 'Invalid username or password.'
      const data = await res.json()
      // Keep token in memory only — never in localStorage
      setToken(data.access_token as string)
      setUser(username)
      return null
    } catch {
      return 'Network error. Please try again.'
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // server unreachable — still clear local state so user isn't stuck
    } finally {
      setToken(null)
      setUser(null)
      router.push('/login')
    }
  }, [router])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
