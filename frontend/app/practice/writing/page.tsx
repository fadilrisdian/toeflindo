'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

const TYPES = [
  { href: '/practice/writing/email',         title: 'Write an Email',      desc: '7 min · 120-140 words' },
  { href: '/practice/writing/discussion',    title: 'Academic Discussion', desc: '10 min · 120-150 words' },
  { href: '/practice/writing/build-a-sentence', title: 'Build a Sentence', desc: 'Word order & grammar drills' },
]

type LatestFeatures = {
  found: true
  practice_log_id: number
  task_type: string
  syntax: number | null
  lexical: number | null
  conventions: number | null
} | { found: false }

interface GrammarHint {
  grammar_type: string
  context: string
  tip: string
}

interface WritingFocusResponse {
  hints: GrammarHint[]
}

function scoreBadgeClass(score: number | null): string {
  if (score === null) return ''
  if (score >= 0.75) return 'fd-badge fd-badge-good'
  if (score >= 0.5)  return 'fd-badge fd-badge-mid'
  return 'fd-badge fd-badge-low'
}

function scorePct(score: number | null): string {
  if (score === null) return '—'
  return `${Math.round(score * 100)}%`
}

function lowestDim(f: Extract<LatestFeatures, { found: true }>): 'syntax' | 'lexical' | 'conventions' | null {
  const candidates: { key: 'syntax' | 'lexical' | 'conventions'; val: number | null }[] = [
    { key: 'syntax',   val: f.syntax },
    { key: 'lexical',  val: f.lexical },
  ]
  const isEmail = f.task_type.toLowerCase().includes('email')
  if (isEmail && f.conventions !== null) candidates.push({ key: 'conventions', val: f.conventions })
  const valid = candidates.filter(c => c.val !== null) as { key: 'syntax' | 'lexical' | 'conventions'; val: number }[]
  if (!valid.length) return null
  return valid.reduce((a, b) => a.val <= b.val ? a : b).key
}

// ── Grammar Focus Panel ────────────────────────────────────────────────────────

function GrammarFocusPanel({ hints }: { hints: GrammarHint[] }) {
  if (!hints.length) return null
  return (
    <div style={{
      marginTop: '1.5rem',
      border: '1px solid #c0dedd',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #eaf5f3, #d6efec)',
        borderBottom: '1px solid #c0dedd',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontWeight: 700, fontSize: '0.78rem', color: '#2a7a7a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          🎯 Grammar Focus for Today
        </span>
        <Link href="/practice/grammar/srs" style={{ fontSize: '0.7rem', color: '#2a7a7a', textDecoration: 'none', fontWeight: 600 }}>
          Review cards →
        </Link>
      </div>

      <div style={{ background: '#fff', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {hints.map((h, i) => (
          <div key={i} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            paddingBottom: i < hints.length - 1 ? 10 : 0,
            borderBottom: i < hints.length - 1 ? '1px solid #f3f4f6' : 'none',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
              background: '#eaf5f3', border: '1px solid #c0dedd',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.65rem', fontWeight: 700, color: '#2a7a7a',
            }}>
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1f2937', marginBottom: 3 }}>
                {h.grammar_type}
                <span style={{ marginLeft: 6, fontSize: '0.68rem', color: '#9ca3af', fontWeight: 400 }}>
                  best in {h.context}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#374151', lineHeight: 1.55 }}>
                {h.tip}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        background: '#fafafa', borderTop: '1px solid #f3f4f6',
        padding: '8px 16px',
      }}>
        <p style={{ margin: 0, fontSize: '0.68rem', color: '#9ca3af' }}>
          These patterns are scheduled for review today. Writing practice that naturally uses them counts as rehearsal.
        </p>
      </div>
    </div>
  )
}

// ── Focus Drills ──────────────────────────────────────────────────────────────

function FocusDrills() {
  const [features, setFeatures] = useState<LatestFeatures | null>(null)

  useEffect(() => {
    api.get<LatestFeatures>('/api/writing/latest-features')
      .then(d => setFeatures(d))
      .catch(() => {})
  }, [])

  if (!features || !features.found) return null

  const isEmail = features.task_type.toLowerCase().includes('email')
  const recommended = lowestDim(features)

  return (
    <div className="fd-section">
      <div className="fd-section-header">
        <span className="fd-section-title">Focus Drills</span>
        <Link
          href={`/dashboard/writing/sessions/${features.practice_log_id}`}
          className="fd-source-link"
        >
          based on your latest writing analysis →
        </Link>
      </div>

      <div className="fd-grid">
        {/* Sentence Combining */}
        <Link href="/practice/writing/sentence-combining" className="fd-card">
          {recommended === 'syntax' && <span className="fd-recommended">Recommended</span>}
          <div className="fd-card-top">
            <span className="fd-card-title">Sentence Combining</span>
            {features.syntax !== null && (
              <span className={scoreBadgeClass(features.syntax)}>{scorePct(features.syntax)}</span>
            )}
          </div>
          <div className="fd-card-desc">Syntax · Clause complexity</div>
        </Link>

        {/* Collocation Notebook */}
        <Link href="/practice/writing/collocation" className="fd-card">
          {recommended === 'lexical' && <span className="fd-recommended">Recommended</span>}
          <div className="fd-card-top">
            <span className="fd-card-title">Collocation Notebook</span>
            {features.lexical !== null && (
              <span className={scoreBadgeClass(features.lexical)}>{scorePct(features.lexical)}</span>
            )}
          </div>
          <div className="fd-card-desc">Vocabulary · Lexical sophistication</div>
        </Link>

        {/* Phrase Bank — email only */}
        {isEmail && (
          <Link href="/practice/writing/phrase-bank" className={`fd-card${recommended === 'conventions' ? '' : ''}`}>
            {recommended === 'conventions' && <span className="fd-recommended">Recommended</span>}
            <div className="fd-card-top">
              <span className="fd-card-title">Phrase Bank</span>
              {features.conventions !== null && (
                <span className={scoreBadgeClass(features.conventions)}>{scorePct(features.conventions)}</span>
              )}
            </div>
            <div className="fd-card-desc">Conventions · Politeness · Email</div>
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

function WritingHubContent() {
  const [grammarHints, setGrammarHints] = useState<GrammarHint[]>([])

  useEffect(() => {
    api.get<WritingFocusResponse>('/api/grammar/srs/writing-focus')
      .then(r => setGrammarHints(r.hints ?? []))
      .catch(() => {})
  }, [])

  return (
    <>
      <Topbar />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6">
          <Link href="/practice" className="text-xs text-[#6b7280] hover:text-[#2a7a7a]">Practice</Link>
          <span className="text-[#d1d5db]">/</span>
          <span className="text-xs font-medium text-[#1f2937]">Writing</span>
        </div>
        <h1 className="text-xl font-bold text-[#1f2937] mb-6">Writing Practice</h1>
        <div className="flex flex-col gap-3">
          {TYPES.map(t => (
            <Link key={t.href} href={t.href}
              className="card p-5 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all">
              <div className="font-bold text-sm text-[#1f2937]">{t.title}</div>
              <div className="text-xs text-[#6b7280] mt-0.5">{t.desc}</div>
            </Link>
          ))}
        </div>

        {/* Grammar focus panel — shown when patterns are due for review */}
        <GrammarFocusPanel hints={grammarHints} />

        <FocusDrills />
      </main>
    </>
  )
}

export default function WritingHubPage() {
  return <RequireAuth><WritingHubContent /></RequireAuth>
}
