'use client'

// =============================================================================
// Grammar Flashcards
// =============================================================================
// Flip-card review of grammar mistakes. Loads from /api/grammar/mistakes.
// Front: wrong sentence + category. Back: correct sentence.
// "Got it"        → marks mistake as reviewed, removes from queue
// "Still learning" → rotates card to back of queue
// =============================================================================

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mistake {
  id: number
  date: string
  category: string
  sub_type: string | null
  section: string | null
  task_type: string | null
  wrong: string
  correct: string
  recurrence_count: number
  reviewed: number
}

interface MistakesResp {
  rows: Mistake[]
  total: number
}

// ── Flip Card ─────────────────────────────────────────────────────────────────

function FlipCard({
  card,
  flipped,
  onFlip,
}: {
  card: Mistake
  flipped: boolean
  onFlip: () => void
}) {
  return (
    <div
      onClick={onFlip}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFlip() } }}
      role="button"
      tabIndex={0}
      aria-label={flipped ? 'Flip to see original mistake' : 'Flip to see correction'}
      style={{
        perspective: '1200px',
        cursor: 'pointer',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          minHeight: 240,
          transformStyle: 'preserve-3d',
          transition: 'transform 0.45s cubic-bezier(0.4,0,0.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* ── Front: wrong sentence ── */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            border: '1px solid #e5e7eb',
            borderRadius: 16,
            background: '#fff',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
          aria-hidden={flipped}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#fff5f5', border: '1px solid #fca5a5',
              borderRadius: 99, padding: '3px 10px',
              fontSize: '0.72rem', fontWeight: 700, color: '#dc2626',
            }}>
              ✕ Wrong
            </span>
            <span style={{
              background: 'var(--teal-50)', color: 'var(--teal-700)',
              borderRadius: 99, padding: '3px 10px',
              fontSize: '0.72rem', fontWeight: 600,
            }}>
              {card.category}
            </span>
            {card.sub_type && (
              <span style={{
                background: '#f3f4f6', color: '#6b7280',
                borderRadius: 99, padding: '3px 10px',
                fontSize: '0.72rem',
              }}>
                {card.sub_type}
              </span>
            )}
            {card.recurrence_count > 1 && (
              <span style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 700, marginLeft: 2 }}>
                {card.recurrence_count}×
              </span>
            )}
          </div>

          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.25rem 0',
          }}>
            <p style={{
              margin: 0, fontSize: '1.05rem', lineHeight: 1.7,
              color: '#1c2430', textAlign: 'center',
              fontStyle: 'italic',
            }}>
              &ldquo;{card.wrong}&rdquo;
            </p>
          </div>

          <p style={{ margin: 0, textAlign: 'center', fontSize: '0.72rem', color: '#9ca3af' }}>
            Tap to reveal correction
          </p>
        </div>

        {/* ── Back: corrected sentence ── */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            border: '1px solid #b7e3c4',
            borderRadius: 16,
            background: '#edf9f1',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
          aria-hidden={!flipped}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#d1fae5', border: '1px solid #86efac',
              borderRadius: 99, padding: '3px 10px',
              fontSize: '0.72rem', fontWeight: 700, color: '#16a34a',
            }}>
              ✓ Correct
            </span>
            <span style={{
              background: 'var(--teal-50)', color: 'var(--teal-700)',
              borderRadius: 99, padding: '3px 10px',
              fontSize: '0.72rem', fontWeight: 600,
            }}>
              {card.category}
            </span>
          </div>

          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.25rem 0',
          }}>
            <p style={{
              margin: 0, fontSize: '1.05rem', lineHeight: 1.7,
              color: '#2e3c36', textAlign: 'center',
              fontWeight: 600,
            }}>
              &ldquo;{card.correct}&rdquo;
            </p>
          </div>

          <div style={{ textAlign: 'center' }}>
            <Link
              href={`/dashboard/grammar/mistakes/${card.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: '0.72rem', color: 'var(--teal-700)', textDecoration: 'none' }}
            >
              View full detail →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Deck ──────────────────────────────────────────────────────────────────────
// Queue-based: current card is always queue[0].
// "Still learning" → rotate to back. "Got it" → remove from front.

function FlashcardDeck({ initialCards }: { initialCards: Mistake[] }) {
  const total = initialCards.length
  const [queue, setQueue] = useState<Mistake[]>([...initialCards])
  const [knownCount, setKnownCount] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(false)
  const [marking, setMarking] = useState(false)

  const card = queue[0]
  const flip = useCallback(() => setFlipped(f => !f), [])

  async function handleGotIt() {
    if (!card || marking) return
    setMarking(true)
    try {
      await api.post(`/api/grammar/mistakes/${card.id}/review`, {})
    } catch {
      // non-critical
    } finally {
      setMarking(false)
    }
    const next = queue.slice(1)
    setKnownCount(k => k + 1)
    if (next.length === 0) {
      setDone(true)
    } else {
      setQueue(next)
      setFlipped(false)
    }
  }

  function handleStillLearning() {
    if (!card) return
    setQueue(q => [...q.slice(1), q[0]])
    setFlipped(false)
  }

  function restart() {
    setQueue([...initialCards])
    setKnownCount(0)
    setFlipped(false)
    setDone(false)
  }

  if (done) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem 1rem', gap: '1.25rem', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>
          🎉
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1f2937' }}>All done!</h2>
          <p style={{ margin: '6px 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            You reviewed all {total} card{total !== 1 ? 's' : ''}.{knownCount > 0 && ` ${knownCount} marked as known.`}
          </p>
        </div>
        <button
          onClick={restart}
          style={{ background: 'var(--teal-700)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.5rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
        >
          Restart deck
        </button>
      </div>
    )
  }

  const progressPct = total > 0 ? Math.round((knownCount / total) * 100) : 0
  const position = total - queue.length + 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem', width: '100%' }}>

      {/* Progress */}
      <div style={{ width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af', marginBottom: 6 }}>
          <span>{knownCount} / {total} known</span>
          <span>{queue.length} remaining</span>
        </div>
        <div style={{ height: 6, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 99, background: 'var(--teal-700)', width: `${progressPct}%`, transition: 'width 0.4s ease' }}
            role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} />
        </div>
      </div>

      <p style={{ margin: 0, fontSize: '0.75rem', color: '#9ca3af' }}>
        Card {position} of {total}{!flipped && ' · tap to flip'}
      </p>

      <div style={{ width: '100%', maxWidth: 560 }}>
        <FlipCard card={card} flipped={flipped} onFlip={flip} />
      </div>

      {flipped ? (
        <div style={{ display: 'flex', gap: '0.75rem', width: '100%', maxWidth: 560 }}>
          <button
            onClick={handleStillLearning}
            style={{ flex: 1, padding: '0.65rem', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontWeight: 600, fontSize: '0.875rem', color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <span style={{ fontSize: '1rem' }}>↺</span> Still learning
          </button>
          <button
            onClick={handleGotIt}
            disabled={marking}
            style={{ flex: 1, padding: '0.65rem', borderRadius: 8, border: 'none', background: marking ? '#e5e7eb' : 'var(--teal-700)', fontWeight: 600, fontSize: '0.875rem', color: marking ? '#9ca3af' : '#fff', cursor: marking ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <span style={{ fontSize: '1rem' }}>✓</span> {marking ? 'Saving…' : 'Got it'}
          </button>
        </div>
      ) : (
        <div style={{ height: 44 }} />
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Filter = 'unreviewed' | 'all'

function FlashcardsContent() {
  const [cards, setCards] = useState<Mistake[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('unreviewed')
  const [deckKey, setDeckKey] = useState(0)

  const load = useCallback((f: Filter) => {
    setLoading(true)
    setErr('')
    const params: Record<string, string | number | boolean> = {
      page: 1,
      page_size: 200,
      sort: 'desc',
      ...(f === 'unreviewed' ? { reviewed: 0 } : {}),
    }
    api.get<MistakesResp>('/api/grammar/mistakes', params)
      .then(r => setCards(r.rows))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(filter) }, [load, filter])

  function switchFilter(f: Filter) {
    setFilter(f)
    setDeckKey(k => k + 1)
  }

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 620, margin: '0 auto', padding: '2rem 1rem' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#9ca3af', marginBottom: '1.5rem' }}>
          <Link href="/practice/grammar" style={{ color: '#6b7280', textDecoration: 'none' }}>Grammar</Link>
          <span>/</span>
          <span style={{ color: '#1f2937', fontWeight: 600 }}>Flashcards</span>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1f2937' }}>Flashcards</h1>
            <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#9ca3af' }}>
              Flip each card to reveal the correction
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['unreviewed', 'all'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => switchFilter(f)}
                style={{
                  padding: '5px 14px', borderRadius: 99, fontSize: '0.78rem', fontWeight: 600,
                  border: '1px solid',
                  borderColor: filter === f ? 'var(--teal-700)' : '#e5e7eb',
                  background: filter === f ? 'var(--teal-700)' : '#fff',
                  color: filter === f ? '#fff' : '#6b7280',
                  cursor: 'pointer',
                }}
              >
                {f === 'unreviewed' ? 'Unreviewed' : 'All'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ color: '#9ca3af', fontSize: '0.85rem', padding: '3rem 0', textAlign: 'center' }}>Loading cards…</div>
        ) : err ? (
          <div style={{ color: '#dc2626', fontSize: '0.85rem', padding: '2rem 0' }}>{err}</div>
        ) : cards.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem 1rem', gap: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem' }}>🎓</div>
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: '#1f2937' }}>
                {filter === 'unreviewed' ? 'No unreviewed mistakes!' : 'No mistakes logged yet.'}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#9ca3af' }}>
                {filter === 'unreviewed'
                  ? 'Switch to "All" to review previously learned cards, or keep practising to log more.'
                  : 'Complete some speaking or writing practice to build your deck.'}
              </p>
            </div>
            {filter === 'unreviewed' && (
              <button
                onClick={() => switchFilter('all')}
                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--teal-700)', background: 'var(--teal-50)', color: 'var(--teal-700)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Show all cards
              </button>
            )}
          </div>
        ) : (
          <FlashcardDeck key={deckKey} initialCards={cards} />
        )}

      </main>
    </>
  )
}

export default function FlashcardsPage() {
  return <RequireAuth><FlashcardsContent /></RequireAuth>
}
