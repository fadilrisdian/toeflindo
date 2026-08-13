'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

// ── Types ─────────────────────────────────────────────────────────────────────

type LatestFeatures =
  | { found: true; practice_log_id: number; task_type: string; syntax: number | null; lexical: number | null; conventions: number | null }
  | { found: false }

// ── Dimension config ──────────────────────────────────────────────────────────

const DIMS = [
  {
    key: 'syntax',
    label: 'Syntax',
    icon: '🏗️',
    iconBg: '#d1fae5', iconColor: '#065f46',
    drill: '/practice/writing/sentence-combining',
    drillLabel: 'Sentence Combining',
    what: 'Clause complexity and sentence variety',
    why: 'The analyzer counts clauses per sentence and checks how varied your sentence structures are. Short, simple sentences keep this score low.',
    how: 'Use subordinate clauses (because, although, which, since, while) in at least 2–3 sentences per response.',
    tip: 'Write 3 rounds of Sentence Combining before every practice session.',
  },
  {
    key: 'lexical',
    label: 'Vocabulary',
    icon: '📚',
    iconBg: '#dbeafe', iconColor: '#1e40af',
    drill: '/practice/writing/collocation',
    drillLabel: 'Collocation Notebook',
    what: 'Vocabulary range, sophistication, and natural word pairings',
    why: 'The analyzer checks for word repetition (CTTR) and measures how many words fall below the top-2000 most common English words (Zipf score). Generic words like "good", "make", "get" actively lower this score.',
    how: 'Rotate academic synonyms: good→substantial, important→critical, shows→demonstrates, but→however, so→consequently.',
    tip: 'Review 2–3 collocations in the notebook before writing. Try to use at least one in your response.',
  },
  {
    key: 'conventions',
    label: 'Conventions',
    icon: '✉️',
    iconBg: '#fce7f3', iconColor: '#9d174d',
    drill: '/practice/writing/phrase-bank',
    drillLabel: 'Phrase Bank',
    what: 'Register formality, politeness, hedge/modal use, and email structure',
    why: 'The analyzer counts hedge expressions (I believe, perhaps, it seems), modal verbs (would, could, should), polite phrases, and checks for informal language and email greeting/closing.',
    how: 'Include at least 1–2 hedge expressions per response. Use "I would appreciate" or "could you please" instead of direct requests. Always open and close your email properly.',
    tip: 'Scan the Phrase Bank before submitting your email to check your register.',
    emailOnly: true,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function scorePct(v: number | null) {
  return v != null ? `${Math.round(v * 100)}%` : null
}

function scoreColor(v: number | null): string {
  if (v == null) return '#9ca3af'
  if (v >= 0.75) return '#15803d'
  if (v >= 0.55) return '#d97706'
  return '#dc2626'
}

function scoreLabel(v: number | null): string {
  if (v == null) return 'No data'
  if (v >= 0.75) return 'Strong'
  if (v >= 0.55) return 'Developing'
  return 'Needs Work'
}

// ── Main ──────────────────────────────────────────────────────────────────────

function WritingAnalysisContent() {
  const router = useRouter()
  const [features, setFeatures] = useState<LatestFeatures | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    api.get<LatestFeatures>('/api/writing/latest-features')
      .then(setFeatures)
      .catch(() => {})
  }, [])

  const isEmail = features?.found && features.task_type.toLowerCase().includes('email')

  function getScore(key: string): number | null {
    if (!features?.found) return null
    if (key === 'syntax') return features.syntax
    if (key === 'lexical') return features.lexical
    if (key === 'conventions') return features.conventions
    return null
  }

  // Find weakest dimension
  const validDims = DIMS
    .filter(d => !d.emailOnly || isEmail)
    .map(d => ({ key: d.key, v: getScore(d.key) }))
    .filter(d => d.v != null) as { key: string; v: number }[]
  const weakestKey = validDims.length
    ? validDims.reduce((a, b) => a.v <= b.v ? a : b).key
    : null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f8f9fa)' }}>
      <Topbar />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <button
            onClick={() => router.back()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '0.85rem', padding: 0, marginBottom: 10 }}
          >
            ← Back
          </button>
          <h1 style={{ margin: '0 0 4px', fontSize: '1.2rem', fontWeight: 700, color: '#1f2937' }}>
            Writing Analysis Drills
          </h1>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
            Practice the three dimensions that determine your writing analysis score.
          </p>
          {features?.found && (
            <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#9ca3af' }}>
              Scores from your latest{' '}
              <Link href={`/dashboard/writing/sessions/${features.practice_log_id}`} style={{ color: '#2a7a7a', textDecoration: 'none', fontWeight: 600 }}>
                {features.task_type}
              </Link>
            </div>
          )}
        </div>

        {/* Dimension cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {DIMS.map(d => {
            if (d.emailOnly && features?.found && !isEmail) return null

            const score = getScore(d.key)
            const isWeakest = d.key === weakestKey
            const isOpen = expanded === d.key
            const barPct = score != null ? Math.round(score * 100) : 0
            const barColor = scoreColor(score)

            return (
              <div
                key={d.key}
                style={{
                  background: '#fff',
                  border: `1px solid ${isWeakest ? '#fecaca' : '#e5e7eb'}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                {/* Card header */}
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                      background: d.iconBg, color: d.iconColor,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.2rem',
                    }}>
                      {d.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1f2937' }}>{d.label}</span>
                        {isWeakest && (
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 700,
                            background: '#fef2f2', color: '#dc2626',
                            border: '1px solid #fecaca', borderRadius: 4,
                            padding: '1px 5px', textTransform: 'uppercase',
                          }}>
                            Focus
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{d.what}</div>
                    </div>
                    {/* Score badge */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {score != null ? (
                        <>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: barColor, lineHeight: 1 }}>
                            {scorePct(score)}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: barColor, fontWeight: 600 }}>
                            {scoreLabel(score)}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>No data</div>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {score != null && (
                    <div style={{ margin: '10px 0 0', background: '#f3f4f6', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 4, transition: 'width 0.4s ease' }} />
                    </div>
                  )}
                </div>

                {/* Expandable detail */}
                <div style={{ borderTop: '1px solid #f3f4f6' }}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : d.key)}
                    style={{
                      width: '100%', background: 'none', border: 'none',
                      padding: '8px 16px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: '0.78rem', color: '#6b7280', fontWeight: 500,
                    }}
                  >
                    <span>{isOpen ? 'Hide details' : 'Why this matters + how to improve'}</span>
                    <span style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                  </button>

                  {isOpen && (
                    <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', marginBottom: 4 }}>Why it matters</div>
                        <div style={{ fontSize: '0.82rem', color: '#1e3a8a', lineHeight: 1.6 }}>{d.why}</div>
                      </div>
                      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', marginBottom: 4 }}>How to improve</div>
                        <div style={{ fontSize: '0.82rem', color: '#166534', lineHeight: 1.6 }}>{d.how}</div>
                      </div>
                      <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#a16207', textTransform: 'uppercase', marginBottom: 4 }}>Quick tip</div>
                        <div style={{ fontSize: '0.82rem', color: '#92400e', lineHeight: 1.6 }}>{d.tip}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* CTA */}
                <div style={{ borderTop: '1px solid #f3f4f6', padding: '10px 16px', background: '#fafafa' }}>
                  <Link
                    href={d.drill}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: '#2a7a7a', color: '#fff',
                      border: 'none', borderRadius: 8,
                      padding: '7px 16px', fontSize: '0.82rem',
                      fontWeight: 600, textDecoration: 'none',
                    }}
                  >
                    Practice: {d.drillLabel} →
                  </Link>
                </div>
              </div>
            )
          })}
        </div>

        {/* No data notice */}
        {features && !features.found && (
          <div style={{
            marginTop: 16, background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 10, padding: '12px 16px',
            fontSize: '0.82rem', color: '#92400e',
          }}>
            No writing analysis data yet. Submit an Email or Discussion practice to see your dimension scores.
          </div>
        )}

      </div>
    </div>
  )
}

export default function WritingAnalysisPage() {
  return <RequireAuth><WritingAnalysisContent /></RequireAuth>
}
