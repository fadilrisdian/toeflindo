'use client'

import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

const CARDS = [
  {
    href: '/admin/practice',
    icon: '📝',
    title: 'Practice Tasks',
    description: 'Add, edit, and delete practice tasks in the task bank. Manage prompts, tags, task types, and metadata.',
    accent: '#2a7a7a',
    bg: '#e0f2f1',
  },
  {
    href: '/admin/answers',
    icon: '✅',
    title: 'Answer Keys',
    description: 'View and fill in model answers for tasks. Quickly spot which tasks are missing an answer.',
    accent: '#1a56c4',
    bg: '#e8f0fe',
  },
]

function AdminHub() {
  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 1rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#1f2937', margin: '0 0 6px' }}>
          🛠️ Admin
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '2rem' }}>
          What would you like to manage?
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {CARDS.map(card => (
            <Link key={card.href} href={card.href} style={{ textDecoration: 'none' }}>
              <div style={{
                background: 'white',
                border: '1px solid #e6e8eb',
                borderRadius: 14,
                padding: '22px 22px 20px',
                boxShadow: '0 1px 4px rgba(16,24,40,.05)',
                cursor: 'pointer',
                transition: 'box-shadow 0.15s, border-color 0.15s',
              }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.boxShadow = '0 4px 16px rgba(16,24,40,.10)'
                  el.style.borderColor = card.accent
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.boxShadow = '0 1px 4px rgba(16,24,40,.05)'
                  el.style.borderColor = '#e6e8eb'
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: card.bg, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '1.4rem', marginBottom: 14,
                }}>
                  {card.icon}
                </div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1f2937', marginBottom: 6 }}>
                  {card.title}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.55 }}>
                  {card.description}
                </div>
                <div style={{
                  marginTop: 18, fontSize: '0.78rem', fontWeight: 600,
                  color: card.accent, display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  Open →
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </>
  )
}

export default function AdminPage() {
  return <RequireAuth><AdminHub /></RequireAuth>
}
