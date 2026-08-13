'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useState, useEffect } from 'react'

const DASH_LINKS = [
  { href: '/dashboard',                   label: 'Overview' },
  { href: '/dashboard/writing',           label: 'Writing' },
  { href: '/dashboard/speaking',          label: 'Speaking' },
  { href: '/dashboard/speaking/analyzer', label: 'Analyzer' },
  { href: '/dashboard/grammar',           label: 'Grammar' },
]

const TOP_LINKS = [
  { href: '/learn',    label: 'Learn' },
  { href: '/practice', label: 'Practice' },
  { href: '/admin',    label: 'Admin' },
]

function WDrillsLink({ isActive }: { isActive: boolean }) {
  return (
    <Link
      href="/dashboard/writing/analyzer"
      className={`topbar-link ${isActive ? 'active' : ''}`}
    >
      W. Drills
    </Link>
  )
}

export default function Topbar() {
  const { user, logout } = useAuth()
  const path = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => { setOpen(false) }, [path])

  function isActive(href: string) {
    if (href === '/dashboard') return path === '/dashboard'
    return path.startsWith(href)
  }

  const allLinks = [
    ...DASH_LINKS,
    { href: '/dashboard/writing/analyzer', label: 'W. Drills' },
    ...TOP_LINKS,
  ]

  return (
    <nav className="topbar sticky top-0 z-50 shadow-sm">
      <div className="topbar-inner">
        {/* Brand */}
        <Link href="/" className="topbar-brand">
          <div className="topbar-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span className="topbar-brand-text">toeflindo</span>
        </Link>

        {/* Desktop nav */}
        <div className="topbar-nav topbar-nav-desktop">
          {DASH_LINKS.map(n => (
            <Link key={n.href} href={n.href}
              className={`topbar-link ${isActive(n.href) ? 'active' : ''}`}>
              {n.label}
            </Link>
          ))}
          <WDrillsLink isActive={path.startsWith('/practice/writing/analysis')} />
          <div className="topbar-divider" />
          {TOP_LINKS.map(n => (
            <Link key={n.href} href={n.href}
              className={`topbar-link ${path === n.href || path.startsWith(n.href + '/') ? 'active' : ''}`}>
              {n.label}
            </Link>
          ))}
          <Link href="/practice" className="topbar-cta">
            + New Practice
          </Link>
        </div>

        {/* Right side: user + hamburger */}
        <div className="topbar-right">
          {user && (
            <div className="topbar-user">
              <span className="topbar-username">{user}</span>
              <button onClick={async () => { try { await logout() } catch { /* already cleaned up in logout() */ } }} className="topbar-signout">Sign out</button>
            </div>
          )}
          <button
            className="topbar-hamburger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {open ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" style={{ width: 20, height: 20 }}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" style={{ width: 20, height: 20 }}>
                <line x1="3" y1="6"  x2="21" y2="6"  />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="topbar-mobile-menu">
          {allLinks.map(n => (
            <Link key={n.href} href={n.href}
              className={`topbar-mobile-link ${isActive(n.href) ? 'active' : ''}`}
              onClick={() => setOpen(false)}>
              {n.label}
            </Link>
          ))}
          <div className="topbar-mobile-divider" />
          <Link href="/practice" className="topbar-mobile-cta" onClick={() => setOpen(false)}>
            + New Practice
          </Link>
          {user && (
            <button onClick={async () => { setOpen(false); try { await logout() } catch { /* cleaned up in logout() */ } }} className="topbar-mobile-signout">
              Sign out ({user})
            </button>
          )}
        </div>
      )}
    </nav>
  )
}
