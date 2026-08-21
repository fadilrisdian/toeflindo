'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useState, useEffect, useRef } from 'react'

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

const W_DRILLS = { href: '/dashboard/writing/analyzer', label: 'W. Drills' }

// ── Icon helpers ────────────────────────────────────────────────────────────
const LINK_ICONS: Record<string, string> = {
  'Overview':  'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0h6',
  'Writing':   'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  'Speaking':  'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
  'Analyzer':  'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  'Grammar':   'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  'W. Drills': 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z',
  'Learn':     'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
  'Practice':  'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  'Admin':     'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
}

function NavIcon({ label }: { label: string }) {
  const d = LINK_ICONS[label]
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ width: 16, height: 16, flexShrink: 0 }}>
      {d.includes('M15 12') ? (
        // admin icon has two paths
        d.split(' M').map((p, i) => (
          <path key={i} d={(i === 0 ? '' : 'M') + p} />
        ))
      ) : (
        <path d={d} />
      )}
    </svg>
  )
}

export default function Topbar() {
  const { user, logout } = useAuth()
  const path = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showToggle, setShowToggle] = useState(false)
  // Ref so the chatbot event handlers always see the latest sidebarOpen without stale closures
  const sidebarOpenRef = useRef(sidebarOpen)
  const prevSidebarRef = useRef(true)

  // Persist sidebar state
  useEffect(() => {
    try {
      const stored = localStorage.getItem('sidebar-open')
      if (stored !== null) setSidebarOpen(stored !== 'false')
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try { localStorage.setItem('sidebar-open', String(sidebarOpen)) } catch { /* ignore */ }
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('sidebar-open', sidebarOpen)
    }
    sidebarOpenRef.current = sidebarOpen
  }, [sidebarOpen])

  // Hide sidebar when chatbot opens on desktop, restore when it closes
  useEffect(() => {
    function onChatbotOpen() {
      prevSidebarRef.current = sidebarOpenRef.current
      setSidebarOpen(false)
    }
    function onChatbotClose() {
      setSidebarOpen(prevSidebarRef.current)
    }
    window.addEventListener('chatbot-open', onChatbotOpen)
    window.addEventListener('chatbot-close', onChatbotClose)
    return () => {
      window.removeEventListener('chatbot-open', onChatbotOpen)
      window.removeEventListener('chatbot-close', onChatbotClose)
    }
  }, [])

  useEffect(() => { setMobileOpen(false) }, [path])

  function isActive(href: string) {
    if (href === '/dashboard') return path === '/dashboard'
    return path.startsWith(href)
  }

  const allLinks = [
    ...DASH_LINKS,
    W_DRILLS,
    ...TOP_LINKS,
  ]

  return (
    <>
      {/* ── DESKTOP SIDEBAR ──────────────────────────────────────── */}
      <aside className={`app-sidebar${sidebarOpen ? ' sidebar-visible' : ' sidebar-hidden'}`}
        aria-label="Main navigation">
        {/* Brand */}
        <Link href="/" className="sidebar-brand">
          <div className="sidebar-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span className="sidebar-brand-text">toeflindo</span>
        </Link>

        {/* Dashboard links */}
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Dashboard</div>
          {DASH_LINKS.map(n => (
            <Link key={n.href} href={n.href}
              className={`sidebar-link${isActive(n.href) ? ' active' : ''}`}>
              <NavIcon label={n.label} />
              <span>{n.label}</span>
            </Link>
          ))}
          <Link href={W_DRILLS.href}
            className={`sidebar-link${path.startsWith('/practice/writing/analysis') ? ' active' : ''}`}>
            <NavIcon label={W_DRILLS.label} />
            <span>{W_DRILLS.label}</span>
          </Link>

          <div className="sidebar-divider" />

          <div className="sidebar-section-label">Sections</div>
          {TOP_LINKS.map(n => (
            <Link key={n.href} href={n.href}
              className={`sidebar-link${(path === n.href || path.startsWith(n.href + '/')) ? ' active' : ''}`}>
              <NavIcon label={n.label} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>

        {/* CTA */}
        <Link href="/practice" className="sidebar-cta-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" style={{ width: 14, height: 14 }}>
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Practice
        </Link>

        {/* User */}
        {user && (
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {user.charAt(0).toUpperCase()}
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-username">{user}</span>
              <button
                onClick={async () => { try { await logout() } catch { /* cleaned up */ } }}
                className="sidebar-signout">
                Sign out
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* ── SIDEBAR TOGGLE BUTTON (desktop) ────────────────────── */}
      {/* Hover zone when sidebar is closed */}
      {!sidebarOpen && (
        <div
          className="sidebar-hover-zone"
          onMouseEnter={() => setShowToggle(true)}
          onMouseLeave={() => setShowToggle(false)}
          onClick={() => setSidebarOpen(true)}
        />
      )}
      <button
        className={`sidebar-toggle-btn${(sidebarOpen || showToggle) ? ' toggle-visible' : ''}`}
        style={{ left: sidebarOpen ? 220 : 12 }}
        onClick={() => setSidebarOpen(o => !o)}
        onMouseEnter={() => setShowToggle(true)}
        onMouseLeave={() => setShowToggle(false)}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
          {sidebarOpen
            ? <><polyline points="15 18 9 12 15 6"/></>
            : <><polyline points="9 18 15 12 9 6"/></>
          }
        </svg>
      </button>

      {/* ── MOBILE TOPBAR ──────────────────────────────────────── */}
      <nav className="topbar sticky top-0 z-50 shadow-sm topbar-mobile-only">
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

          {/* Desktop nav — hidden on mobile via parent class, but keeping for structure */}
          <div className="topbar-nav topbar-nav-desktop">
            {DASH_LINKS.map(n => (
              <Link key={n.href} href={n.href}
                className={`topbar-link ${isActive(n.href) ? 'active' : ''}`}>
                {n.label}
              </Link>
            ))}
            <Link href={W_DRILLS.href}
              className={`topbar-link ${path.startsWith('/practice/writing/analysis') ? 'active' : ''}`}>
              {W_DRILLS.label}
            </Link>
            <div className="topbar-divider" />
            {TOP_LINKS.map(n => (
              <Link key={n.href} href={n.href}
                className={`topbar-link ${path === n.href || path.startsWith(n.href + '/') ? 'active' : ''}`}>
                {n.label}
              </Link>
            ))}
            <Link href="/practice" className="topbar-cta">+ New Practice</Link>
          </div>

          {/* Right side */}
          <div className="topbar-right">
            {user && (
              <div className="topbar-user">
                <span className="topbar-username">{user}</span>
                <button
                  onClick={async () => { try { await logout() } catch { /* cleaned up */ } }}
                  className="topbar-signout">
                  Sign out
                </button>
              </div>
            )}
            <button
              className="topbar-hamburger"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(o => !o)}
            >
              {mobileOpen ? (
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
        {mobileOpen && (
          <div className="topbar-mobile-menu">
            {allLinks.map(n => (
              <Link key={n.href} href={n.href}
                className={`topbar-mobile-link ${isActive(n.href) ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}>
                {n.label}
              </Link>
            ))}
            <div className="topbar-mobile-divider" />
            <Link href="/practice" className="topbar-mobile-cta" onClick={() => setMobileOpen(false)}>
              + New Practice
            </Link>
            {user && (
              <button
                onClick={async () => {
                  setMobileOpen(false)
                  try { await logout() } catch { /* cleaned up */ }
                }}
                className="topbar-mobile-signout">
                Sign out ({user})
              </button>
            )}
          </div>
        )}
      </nav>
    </>
  )
}
