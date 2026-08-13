/**
 * Thin wrapper around fetch that:
 *  - sends credentials (httpOnly cookie) automatically
 *  - throws on non-2xx responses
 *
 * Token is stored in an httpOnly cookie set by the server — never in localStorage.
 */

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>
}

function buildUrl(path: string, params?: FetchOptions['params']): string {
  const url = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v))
    })
  }
  return url.pathname + url.search
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { params, ...init } = options
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(buildUrl(path, params), {
    ...init,
    headers,
    cache: 'no-store',
    credentials: 'include', // send the httpOnly auth cookie on every request
  })
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    throw new Error('Unauthenticated')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }
  // 204 No Content (e.g. DELETE) — no body to parse
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T = unknown>(path: string, params?: FetchOptions['params']) =>
    apiFetch<T>(path, { method: 'GET', params }),
  post: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
  put: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T = unknown>(path: string) =>
    apiFetch<T>(path, { method: 'DELETE' }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  getRaw: (path: string, params?: FetchOptions['params']): Promise<string> => {
    const { params: _p, ...init }: FetchOptions = { method: 'GET', params }
    return (async () => {
      const headers = new Headers(init.headers)
      const res = await fetch(buildUrl(path, params), {
        ...init,
        headers,
        cache: 'no-store',
        credentials: 'include',
      })
      if (res.status === 401) {
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
        throw new Error('Unauthenticated')
      }
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`API ${res.status}: ${text}`)
      }
      return res.text()
    })()
  },
}
