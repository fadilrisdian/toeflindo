'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

type PhraseCategory = {
  name: string
  phrases: string[]
}

type PhraseBank = {
  categories: PhraseCategory[]
}

const CATEGORY_ICONS: Record<string, string> = {
  Greeting: '👋',
  Purpose: '✉️',
  Request: '🙏',
  Apology: '😔',
  Closing: '🤝',
  'Sign-off': '✍️',
}

function PhraseBankContent() {
  const [bank, setBank] = useState<PhraseBank | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    api.get<PhraseBank>('/api/focus-drills/phrase-bank')
      .then(d => setBank(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function copyPhrase(phrase: string) {
    navigator.clipboard.writeText(phrase).then(() => {
      setCopied(phrase)
      setTimeout(() => setCopied(null), 1500)
    }).catch(() => {})
  }

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24, fontSize: '0.78rem', color: '#6b7280' }}>
          <Link href="/practice" style={{ color: '#6b7280', textDecoration: 'none' }}>Practice</Link>
          <span>/</span>
          <Link href="/practice/writing" style={{ color: '#6b7280', textDecoration: 'none' }}>Writing</Link>
          <span>/</span>
          <span style={{ color: '#1f2937', fontWeight: 600 }}>Phrase Bank</span>
        </div>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1f2937', marginBottom: 4 }}>Phrase Bank</h1>
          <p style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.6 }}>
            Register-safe email phrases organised by function. Browse before practice — rotate variants to avoid overuse.
          </p>
        </div>

        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 14px', marginBottom: 24, fontSize: '0.8rem', color: '#92400e', lineHeight: 1.6 }}>
          <strong>Tip:</strong> Don't memorise all phrases. Pick 1–2 per category you feel comfortable with, then rotate. Variety matters more than quantity.
        </div>

        {loading && (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: '0.88rem' }}>Loading phrase bank…</div>
        )}

        {bank && bank.categories.map(cat => (
          <div key={cat.name} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: '1.1rem' }}>{CATEGORY_ICONS[cat.name] ?? '📌'}</span>
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1f2937' }}>{cat.name}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cat.phrases.map(phrase => (
                <div key={phrase}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'white', border: '1px solid #e6e8eb', borderRadius: 8,
                    padding: '10px 14px', gap: 12,
                  }}>
                  <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.5 }}>{phrase}</span>
                  <button
                    onClick={() => copyPhrase(phrase)}
                    title="Copy to clipboard"
                    style={{
                      flexShrink: 0, background: copied === phrase ? '#e8f5e9' : '#f9fafb',
                      border: '1px solid', borderColor: copied === phrase ? '#a5d6a7' : '#e0e0e0',
                      borderRadius: 6, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 600,
                      color: copied === phrase ? '#2e7d32' : '#6b7280',
                      cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap',
                    }}>
                    {copied === phrase ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {bank && (
          <div style={{ marginTop: 32, padding: '16px 18px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0c4a6e', marginBottom: 8 }}>📋 Pre-practice checklist</div>
            <div style={{ fontSize: '0.82rem', color: '#0369a1', lineHeight: 1.8 }}>
              {[
                'Does my email have a Greeting?',
                'Did I state my Purpose clearly?',
                'Is my Request phrased politely?',
                'Did I include a Closing line?',
                'Did I add a Sign-off before my name?',
                'Is my register consistent throughout?',
              ].map((item, i) => (
                <CheckItem key={i} label={item} />
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  )
}

function CheckItem({ label }: { label: string }) {
  const [checked, setChecked] = useState(false)
  return (
    <div
      onClick={() => setChecked(v => !v)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', marginBottom: 2 }}>
      <span style={{
        width: 16, height: 16, borderRadius: 4, border: '1.5px solid',
        borderColor: checked ? '#0284c7' : '#7dd3fc',
        background: checked ? '#0284c7' : 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, fontSize: '0.65rem', color: 'white',
        transition: 'all 0.12s',
      }}>
        {checked ? '✓' : ''}
      </span>
      <span style={{ textDecoration: checked ? 'line-through' : 'none', color: checked ? '#7dd3fc' : '#0369a1' }}>{label}</span>
    </div>
  )
}

export default function PhraseBankPage() {
  return <RequireAuth><PhraseBankContent /></RequireAuth>
}
