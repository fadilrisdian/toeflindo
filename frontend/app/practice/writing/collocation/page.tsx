'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

type CollocationItem = {
  id: number
  phrase: string
  source: string
  box_level: number
  next_review_date: string
  review_count: number
}

type Exercise = {
  found: boolean
  item?: CollocationItem
  exercise?: {
    phrase: string
    contexts: { task_type: string; instruction: string }[]
  }
}

type ReviewResult = {
  correct: boolean
  feedback: string
  register_ok: boolean
  item_id: number
}

type Tab = 'review' | 'add' | 'list'
type ReviewPhase = 'loading' | 'ready' | 'answering' | 'submitting' | 'done' | 'empty'

function boxLabel(level: number) {
  const labels = ['', 'Box 1 · Daily', 'Box 2 · 3 days', 'Box 3 · Weekly', 'Box 4 · Biweekly', 'Box 5 · Monthly']
  return labels[level] ?? `Box ${level}`
}

function CollocationContent() {
  const [tab, setTab] = useState<Tab>('review')

  // review tab
  const [reviewPhase, setReviewPhase] = useState<ReviewPhase>('loading')
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [contextIdx, setContextIdx] = useState(0)
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [reviewError, setReviewError] = useState('')

  // add tab
  const [newPhrase, setNewPhrase] = useState('')
  const [newSource, setNewSource] = useState('')
  const [addStatus, setAddStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // list tab
  const [items, setItems] = useState<CollocationItem[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [listLoading, setListLoading] = useState(false)

  const loadDue = useCallback(async () => {
    setReviewPhase('loading')
    setResult(null)
    setAnswer('')
    setContextIdx(0)
    setReviewError('')
    try {
      const data = await api.get<Exercise>('/api/focus-drills/collocation/due')
      setExercise(data)
      setReviewPhase(data.found ? 'ready' : 'empty')
    } catch {
      setReviewError('Could not load exercise.')
      setReviewPhase('empty')
    }
  }, [])

  const loadList = useCallback(async () => {
    setListLoading(true)
    try {
      const data = await api.get<{ items: CollocationItem[]; due_count: number }>('/api/focus-drills/collocation/items')
      setItems(data.items)
      setDueCount(data.due_count)
    } catch { /* silent */ }
    setListLoading(false)
  }, [])

  useEffect(() => { loadDue() }, [loadDue])

  useEffect(() => {
    if (tab === 'list') loadList()
  }, [tab, loadList])

  async function handleReview() {
    if (!exercise?.item || !answer.trim()) return
    setReviewPhase('submitting')
    const ctx = exercise.exercise!.contexts[contextIdx]
    try {
      const data = await api.post<ReviewResult>('/api/focus-drills/collocation/review', {
        item_id: exercise.item.id,
        context_index: contextIdx,
        user_sentence: answer.trim(),
        task_type: ctx.task_type,
      })
      setResult(data)
      setReviewPhase('done')
    } catch {
      setReviewError('Evaluation failed. Please try again.')
      setReviewPhase('answering')
    }
  }

  async function handleAdd() {
    if (!newPhrase.trim()) return
    setAddStatus('saving')
    try {
      await api.post('/api/focus-drills/collocation/add', { phrase: newPhrase.trim(), source: newSource.trim() })
      setAddStatus('saved')
      setNewPhrase('')
      setNewSource('')
      setTimeout(() => setAddStatus('idle'), 2000)
    } catch {
      setAddStatus('error')
    }
  }

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '8px 18px', border: 'none', borderBottom: tab === t ? '2.5px solid #2a7a7a' : '2.5px solid transparent',
    background: 'none', fontWeight: 600, fontSize: '0.85rem',
    color: tab === t ? '#2a7a7a' : '#6b7280', cursor: 'pointer',
  })

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '40px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24, fontSize: '0.78rem', color: '#6b7280' }}>
          <Link href="/practice" style={{ color: '#6b7280', textDecoration: 'none' }}>Practice</Link>
          <span>/</span>
          <Link href="/practice/writing" style={{ color: '#6b7280', textDecoration: 'none' }}>Writing</Link>
          <span>/</span>
          <span style={{ color: '#1f2937', fontWeight: 600 }}>Collocation Notebook</span>
        </div>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1f2937', marginBottom: 4 }}>Collocation Notebook</h1>
          <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>
            Active vocabulary through spaced review — capture phrases, generate sentences, build fluency.
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 24 }}>
          <button style={tabStyle('review')} onClick={() => setTab('review')}>
            Review {dueCount > 0 && <span style={{ background: '#ef4444', color: 'white', fontSize: '0.65rem', padding: '1px 6px', borderRadius: 10, marginLeft: 4 }}>{dueCount}</span>}
          </button>
          <button style={tabStyle('add')} onClick={() => setTab('add')}>+ Add Phrase</button>
          <button style={tabStyle('list')} onClick={() => setTab('list')}>My Notebook</button>
        </div>

        {/* Review tab */}
        {tab === 'review' && (
          <>
            {reviewError && (
              <div style={{ background: '#fce4ec', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.82rem', color: '#c62828' }}>{reviewError}</div>
            )}
            {reviewPhase === 'loading' && (
              <div style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: '0.88rem' }}>Loading…</div>
            )}
            {reviewPhase === 'empty' && (
              <div style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: 32, textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: 12 }}>📭</div>
                <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: 8 }}>No items due for review</div>
                <div style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: 20 }}>Add phrases to your notebook and they will appear here when due.</div>
                <button onClick={() => setTab('add')}
                  style={{ background: '#2a7a7a', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}>
                  Add a phrase
                </button>
              </div>
            )}
            {exercise?.found && exercise.item && exercise.exercise && reviewPhase !== 'loading' && (
              <div style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: 24 }}>
                {/* Phrase */}
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', marginBottom: 8 }}>Use this phrase</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#2a7a7a', marginBottom: 6 }}>"{exercise.item.phrase}"</div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{boxLabel(exercise.item.box_level)}</div>
                </div>

                {/* Context selector */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {exercise.exercise.contexts.map((ctx, i) => (
                    <button key={i} onClick={() => { setContextIdx(i); setAnswer(''); setResult(null); if (reviewPhase === 'done') setReviewPhase('ready') }}
                      disabled={reviewPhase === 'submitting'}
                      style={{
                        flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                        border: contextIdx === i ? '1.5px solid #2a7a7a' : '1px solid #e0e0e0',
                        background: contextIdx === i ? '#eaf5f3' : 'white',
                        color: contextIdx === i ? '#2a7a7a' : '#6b7280',
                        cursor: reviewPhase === 'submitting' ? 'default' : 'pointer',
                      }}>
                      {ctx.task_type === 'email' ? '📧 Email' : '🎓 Discussion'}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.6, marginBottom: 16, padding: '10px 14px', background: '#f9fafb', borderRadius: 8 }}>
                  {exercise.exercise.contexts[contextIdx].instruction}
                </div>

                <textarea
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  disabled={reviewPhase === 'done' || reviewPhase === 'submitting'}
                  placeholder="Write your sentence here…"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                    border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.92rem',
                    lineHeight: 1.5, resize: 'vertical', outline: 'none', marginBottom: 16,
                    background: reviewPhase === 'done' ? '#f9fafb' : 'white',
                  }}
                />

                {reviewPhase !== 'done' && (
                  <button onClick={handleReview}
                    disabled={!answer.trim() || reviewPhase === 'submitting'}
                    style={{
                      background: !answer.trim() ? '#e5e7eb' : '#2a7a7a',
                      color: !answer.trim() ? '#9ca3af' : 'white',
                      border: 'none', borderRadius: 8, padding: '10px 24px',
                      fontSize: '0.88rem', fontWeight: 600,
                      cursor: !answer.trim() ? 'not-allowed' : 'pointer',
                    }}>
                    {reviewPhase === 'submitting' ? 'Checking…' : 'Submit'}
                  </button>
                )}

                {result && reviewPhase === 'done' && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{
                      padding: '12px 16px', borderRadius: 8, marginBottom: 16,
                      background: result.correct ? '#e8f5e9' : '#fce4ec',
                      border: `1px solid ${result.correct ? '#a5d6a7' : '#f48fb1'}`,
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: result.correct ? '#2e7d32' : '#c62828', marginBottom: 4 }}>
                        {result.correct ? '✓ Correct — moved to next box' : '✗ Needs work — reset to Box 1'}
                        {!result.register_ok && ' · Register mismatch'}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.5 }}>{result.feedback}</div>
                    </div>
                    <button onClick={loadDue}
                      style={{ background: '#2a7a7a', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}>
                      Next phrase
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Add tab */}
        {tab === 'add' && (
          <div style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Collocation phrase</label>
              <input
                type="text"
                value={newPhrase}
                onChange={e => setNewPhrase(e.target.value)}
                placeholder='e.g. "raise a concern" or "have a significant impact on"'
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.92rem', outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Source <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
              <input
                type="text"
                value={newSource}
                onChange={e => setNewSource(e.target.value)}
                placeholder="e.g. TOEFL model answer, textbook"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.92rem', outline: 'none' }}
              />
            </div>
            <button onClick={handleAdd}
              disabled={!newPhrase.trim() || addStatus === 'saving'}
              style={{
                background: !newPhrase.trim() ? '#e5e7eb' : '#2a7a7a',
                color: !newPhrase.trim() ? '#9ca3af' : 'white',
                border: 'none', borderRadius: 8, padding: '10px 24px',
                fontSize: '0.88rem', fontWeight: 600,
                cursor: !newPhrase.trim() ? 'not-allowed' : 'pointer',
              }}>
              {addStatus === 'saving' ? 'Saving…' : addStatus === 'saved' ? '✓ Saved!' : 'Add to notebook'}
            </button>
            {addStatus === 'error' && <div style={{ marginTop: 10, fontSize: '0.82rem', color: '#c62828' }}>Failed to save. Try again.</div>}
            <div style={{ marginTop: 20, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.6 }}>
              New phrases go to Box 1 and are due for review tomorrow. Correct → advance one box. Incorrect → back to Box 1.
            </div>
          </div>
        )}

        {/* List tab */}
        {tab === 'list' && (
          <div>
            {listLoading && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.88rem', padding: 32 }}>Loading…</div>}
            {!listLoading && items.length === 0 && (
              <div style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: '0.88rem' }}>
                No phrases yet. Add your first collocation phrase.
              </div>
            )}
            {!listLoading && items.length > 0 && items.map(item => (
              <div key={item.id} style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 10, padding: '14px 18px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.92rem', color: '#1f2937', marginBottom: 2 }}>{item.phrase}</div>
                  {item.source && <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Source: {item.source}</div>}
                </div>
                <div style={{ textAlign: 'right', minWidth: 90 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2a7a7a', marginBottom: 2 }}>Box {item.box_level}</div>
                  <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>Due {item.next_review_date}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}

export default function CollocationPage() {
  return <RequireAuth><CollocationContent /></RequireAuth>
}
