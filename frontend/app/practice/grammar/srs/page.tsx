'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SRSItem {
  id: number
  grammar_type: string
  sub_type: string | null
  section: string | null
  task_type: string | null
  wrong: string
  correct: string
  explanation: string | null
  review_stage: number
  remediation_status: string
  next_review_date: string | null
  recurrence_count: number
  treatability: string
  rubric_dimension: string
}

interface QueueResponse {
  items: SRSItem[]
  count: number
}

interface RateResult {
  ok: boolean
  review_stage: number
  next_review_date: string
  remediation_status: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STAGE_NEXT: Record<number, string> = {
  0: '1 day',
  1: '3 days',
  2: '7 days',
  3: '14 days',
  4: '30 days',
}

const STATUS_COLOR: Record<string, string> = {
  new:      '#9ca3af',
  engaged:  '#2a7a7a',
  mastered: '#15803d',
}

const DIM_COLOR: Record<string, string> = {
  grammar:    '#1d4ed8',
  vocabulary: '#7c3aed',
}

const DIM_LABEL: Record<string, string> = {
  grammar:    'Grammar',
  vocabulary: 'Vocabulary',
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: '0.68rem', fontWeight: 600,
      background: color + '18', color, border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  )
}

// ── Session summary ───────────────────────────────────────────────────────────

function SessionDone({
  total, passed, failed, onRestart,
}: { total: number; passed: number; failed: number; onRestart: () => void }) {
  const router = useRouter()
  return (
    <div style={{ maxWidth: 520, margin: '4rem auto', padding: '0 1rem', textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🎯</div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>
        Session complete!
      </h2>
      <p style={{ fontSize: '0.88rem', color: '#6b7280', marginBottom: 24 }}>
        {total} card{total !== 1 ? 's' : ''} reviewed
      </p>

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 28 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#15803d' }}>{passed}</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>passed</div>
        </div>
        <div style={{ width: 1, background: '#e5e7eb' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: failed > 0 ? '#dc2626' : '#9ca3af' }}>{failed}</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>needs work</div>
        </div>
      </div>

      {failed > 0 && (
        <p style={{ fontSize: '0.82rem', color: '#b45309', marginBottom: 20,
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 14px' }}>
          {failed} pattern{failed !== 1 ? 's' : ''} re-appeared — rescheduled for tomorrow.
          Head to the Strengthen flow to drill them again.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {total > 0 && (
          <button onClick={onRestart} style={ghostBtnStyle}>
            Review again
          </button>
        )}
        <button
          onClick={() => router.push('/practice/grammar')}
          style={primaryBtnStyle}
        >
          Grammar hub
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

function SRSContent() {
  const [items, setItems]       = useState<SRSItem[]>([])
  const [idx, setIdx]           = useState(0)
  const [loading, setLoading]   = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [rating, setRating]     = useState(false)
  const [err, setErr]           = useState('')

  // Session stats
  const [passed, setPassed] = useState(0)
  const [failed, setFailed] = useState(0)
  const [done, setDone]     = useState(false)

  function loadQueue() {
    setLoading(true)
    setDone(false)
    setIdx(0)
    setPassed(0)
    setFailed(0)
    setRevealed(false)
    api.get<QueueResponse>('/api/grammar/srs/queue?limit=20')
      .then(r => { setItems(r.items); if (r.items.length === 0) setDone(true) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadQueue() }, [])

  async function rate(passedThis: boolean) {
    const item = items[idx]
    if (!item) return
    setRating(true)
    try {
      await api.post<RateResult>(`/api/grammar/srs/rate/${item.id}`, { passed: passedThis })
      if (passedThis) setPassed(p => p + 1)
      else setFailed(f => f + 1)

      const nextIdx = idx + 1
      if (nextIdx >= items.length) {
        setDone(true)
      } else {
        setIdx(nextIdx)
        setRevealed(false)
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error rating card')
    } finally {
      setRating(false)
    }
  }

  if (err) return (
    <div style={{ padding: '2rem' }}>
      <p style={{ color: '#dc2626' }}>{err}</p>
      <Link href="/practice/grammar" style={{ color: '#2a7a7a', fontSize: '0.85rem' }}>← Grammar hub</Link>
    </div>
  )

  if (loading) return (
    <div style={{ padding: '2rem', color: '#6b7280', fontSize: '0.9rem' }}>Loading…</div>
  )

  if (done) return (
    <SessionDone
      total={passed + failed}
      passed={passed}
      failed={failed}
      onRestart={loadQueue}
    />
  )

  const item = items[idx]
  if (!item) return null

  const progress = Math.round(((idx) / items.length) * 100)

  return (
    <div style={{ maxWidth: 580, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <Link href="/practice/grammar" style={{ color: '#2a7a7a', fontSize: '0.85rem', textDecoration: 'none' }}>
          ← Grammar hub
        </Link>
        <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
          {idx + 1} / {items.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: '#f3f4f6', borderRadius: 4, marginBottom: '1.5rem', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4,
          background: '#2a7a7a',
          width: `${progress}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Card */}
      <div style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: '1.25rem',
      }}>
        {/* Card header */}
        <div style={{
          background: '#f9fafb',
          borderBottom: '1px solid #f3f4f6',
          padding: '12px 18px',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1f2937' }}>
            {item.grammar_type}
          </span>
          {item.sub_type && <Pill label={item.sub_type} color="#2a7a7a" />}
          <Pill label={DIM_LABEL[item.rubric_dimension] || item.rubric_dimension} color={DIM_COLOR[item.rubric_dimension] || '#374151'} />
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: STATUS_COLOR[item.remediation_status], fontWeight: 600 }}>
            Stage {item.review_stage}
          </span>
        </div>

        {/* Wrong sentence — always shown */}
        <div style={{ padding: '20px 20px 16px' }}>
          <div style={{
            fontSize: '0.68rem', fontWeight: 700, color: '#dc2626',
            textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8,
          }}>
            Error pattern to recall
          </div>
          <div style={{
            fontSize: '1.05rem', lineHeight: 1.7, color: '#111827',
            background: '#fff8f7', border: '1px solid #fecaca',
            borderRadius: 10, padding: '14px 16px',
          }}>
            {item.wrong}
          </div>
          {item.recurrence_count > 1 && (
            <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 6 }}>
              Seen {item.recurrence_count}× in practice
            </div>
          )}
        </div>

        {/* Tap to reveal */}
        {!revealed ? (
          <div style={{ padding: '0 20px 20px' }}>
            <button
              onClick={() => setRevealed(true)}
              style={{
                width: '100%', padding: '12px',
                background: '#f9fafb', border: '1px dashed #d1d5db',
                borderRadius: 10, cursor: 'pointer',
                fontSize: '0.88rem', color: '#6b7280', fontWeight: 600,
              }}
            >
              Tap to reveal the correct version →
            </button>
          </div>
        ) : (
          <>
            {/* Correct version */}
            <div style={{ padding: '0 20px 14px' }}>
              <div style={{
                fontSize: '0.68rem', fontWeight: 700, color: '#15803d',
                textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8,
              }}>
                Correct version
              </div>
              <div style={{
                fontSize: '1.05rem', lineHeight: 1.7, color: '#166534',
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: 10, padding: '14px 16px',
              }}>
                {item.correct}
              </div>
            </div>

            {/* Explanation */}
            {item.explanation && (
              <div style={{ padding: '0 20px 14px' }}>
                <div style={{
                  fontSize: '0.68rem', fontWeight: 700, color: '#6b7280',
                  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8,
                }}>
                  Why
                </div>
                <div style={{
                  fontSize: '0.88rem', lineHeight: 1.65, color: '#374151',
                  background: '#fffaf2', border: '1px solid #e7ded2',
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  {item.explanation}
                </div>
              </div>
            )}

            {/* Rating buttons */}
            <div style={{
              padding: '14px 20px 20px',
              borderTop: '1px solid #f3f4f6',
              background: '#fafafa',
            }}>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 10, textAlign: 'center' }}>
                How well did you recall the correct pattern?
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => rate(false)}
                  disabled={rating}
                  style={{
                    flex: 1, padding: '12px 0', borderRadius: 10, cursor: rating ? 'default' : 'pointer',
                    border: '1px solid #fecaca', background: rating ? '#f9fafb' : '#fff1f2',
                    color: '#dc2626', fontWeight: 700, fontSize: '0.9rem',
                    opacity: rating ? 0.55 : 1,
                  }}
                >
                  ✗ Still unsure
                </button>
                <button
                  onClick={() => rate(true)}
                  disabled={rating}
                  style={{
                    flex: 1, padding: '12px 0', borderRadius: 10, cursor: rating ? 'default' : 'pointer',
                    border: '1px solid #bbf7d0', background: rating ? '#f9fafb' : '#f0fdf4',
                    color: '#15803d', fontWeight: 700, fontSize: '0.9rem',
                    opacity: rating ? 0.55 : 1,
                  }}
                >
                  ✓ Got it right
                </button>
              </div>
              <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: 8, textAlign: 'center' }}>
                {rating
                  ? 'Saving…'
                  : `Got it right → next review in ${STAGE_NEXT[Math.min(item.review_stage + 1, 4)]}`}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Strengthen shortcut */}
      <div style={{ textAlign: 'center' }}>
        <Link
          href={`/practice/grammar/remediate/${item.id}`}
          style={{ fontSize: '0.78rem', color: '#2a7a7a', textDecoration: 'none' }}
        >
          🎯 Open Strengthen flow for this pattern →
        </Link>
      </div>

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  background: '#2a7a7a', color: '#fff',
  border: 'none', borderRadius: 8, padding: '0.6rem 1.4rem',
  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
}

const ghostBtnStyle: React.CSSProperties = {
  background: '#fff', color: '#374151',
  border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.6rem 1.4rem',
  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
}

export default function SRSPage() {
  return <RequireAuth><SRSContent /></RequireAuth>
}
