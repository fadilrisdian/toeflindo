'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'

interface Task { task_id: number; question: string; word_bank: string; answer: string }
interface TasksResp { rows: Task[] }

interface BASItem {
  task_id:  number
  question: string
  template: string  // the ___ ___ ___ line
  words:    string[]
  answer:   string
  selected: string[]
  checked:  boolean
  correct:  boolean
}

function normalize(s: string) {
  // strip punctuation, collapse whitespace, lowercase
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

// Remove all fixed template parts (non-blank chunks) from a string before comparing.
// Uses word-boundary regex to avoid partial matches (e.g. "no" inside "not").
function extractBlanksFromAnswer(answer: string, template: string): string {
  const norm = normalize(answer)
  if (!template) return norm
  const fixedChunks = template
    .split(/_{2,}/)
    .map(s => normalize(s))
    .filter(Boolean)
  let result = norm
  for (const chunk of fixedChunks) {
    const escaped = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'i'), '').replace(/\s+/g, ' ').trim()
  }
  return result
}

function parseQuestion(raw: string) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  // line 0 = context statement, find the ___ template line, ignore Words: line
  const context  = lines[0] ?? ''
  const template = lines.find(l => l.includes('___') && !l.startsWith('Words:')) ?? ''
  return { context, template }
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

function buildItems(tasks: Task[]): BASItem[] {
  return tasks.map(t => {
    const { template } = parseQuestion(t.question)
    return {
      task_id:  t.task_id,
      question: t.question,
      template,
      words:    shuffle((t.word_bank || '').split('|').map(w => w.trim()).filter(Boolean)),
      answer:   t.answer,
      selected: [],
      checked:  false,
      correct:  false,
    }
  })
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toString().padStart(2, '0')
  return `00:${m}:${s}`
}

const TOTAL_TIME = 5 * 60 + 50  // 5:50

function BasGoContent() {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const group = searchParams.get('group') ?? ''
  const [items, setItems]   = useState<BASItem[]>([])
  const [idx, setIdx]       = useState(0)
  const [seconds, setSec]   = useState(TOTAL_TIME)
  const [started, setStart] = useState(false)
  const [timerVis, setTmrVis] = useState(true)
  const [saved, setSaved]   = useState(false)
  const [done, setDone]     = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load tasks — filter by group tag if provided
  useEffect(() => {
    const fullTag = group ? `Build a Sentence, ${group}` : ''
    api.get<TasksResp>('/api/task/bank', {
      task_type: 'Build a Sentence',
      ...(fullTag ? { tags: fullTag } : {}),
      page_size: 100,
    })
      .then(d => {
        // specific group: preserve DB order; no group: random 10
        const rows = fullTag ? d.rows : shuffle(d.rows).slice(0, 10)
        setItems(buildItems(rows))
      })
  }, [group])

  // Timer
  useEffect(() => {
    if (!started) return
    timerRef.current = setInterval(() => {
      setSec(s => {
        if (s <= 1) {
          clearInterval(timerRef.current!)
          setDone(true)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [started])

  const cur = items[idx]

  function selectWord(word: string) {
    if (!cur || cur.checked) return
    setItems(prev => prev.map((it, i) => i !== idx
      ? it : { ...it, selected: [...it.selected, word] }
    ))
  }

  function deselectWord(selIdx: number) {
    if (!cur || cur.checked) return
    setItems(prev => prev.map((it, i) => i !== idx
      ? it : { ...it, selected: it.selected.filter((_, j) => j !== selIdx) }
    ))
  }

  function checkItem() {
    if (!cur || !cur.selected.length) return
    const your_answer = cur.selected.join(' ')
    const correct = extractBlanksFromAnswer(your_answer, cur.template) === extractBlanksFromAnswer(cur.answer, cur.template)
    setItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, checked: true, correct }))
  }

  function resetItem() {
    setItems(prev => prev.map((it, i) => i !== idx
      ? it : { ...it, selected: [], checked: false, correct: false }
    ))
  }

  function nextItem() {
    if (idx + 1 >= items.length) {
      if (timerRef.current) clearInterval(timerRef.current)
      setDone(true)
    } else {
      setIdx(i => i + 1)
    }
  }

  async function saveResults() {
    const results = items.filter(it => it.checked).map(it => ({
      task_id:     it.task_id,
      your_answer: it.selected.join(' '),
      answer:      it.answer,
      correct:     it.correct,
      checked:     true,
    }))
    await api.post('/api/practice/writing/bas/submit', { results })
    setSaved(true)
  }

  // Auto-save when results screen appears
  useEffect(() => {
    if (done && !saved && items.some(it => it.checked)) {
      saveResults().catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  // Word availability (handle duplicates)
  function availableWords(item: BASItem): { word: string; available: boolean }[] {
    return item.words.map((word, j) => {
      const usedCount  = item.selected.filter(w => w === word).length
      const totalCount = item.words.filter(w => w === word).length
      // only mark the first (totalCount - usedCount) occurrences as available
      const priorSameIdx = item.words.slice(0, j).filter(w => w === word).length
      return { word, available: priorSameIdx < totalCount - usedCount }
    })
  }

  const timerColor = seconds <= 60 && started ? '#dc2626'
    : seconds <= 120 && started ? '#b45309' : '#1f2937'

  const correctCount = items.filter(it => it.correct).length
  const checkedCount = items.filter(it => it.checked).length

  // ── Results screen ──
  if (done) {
    return (
      <div style={{ background: '#b0b0b0', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ width: 1060, maxWidth: '100%', minHeight: '100vh', background: '#e8e8e8', display: 'flex', flexDirection: 'column' }}>
          {/* Top bar */}
          <div style={{ background: '#2a7a7a', height: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
            <span style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>Build a Sentence — Results</span>
          </div>

          <div style={{ flex: 1, padding: '32px 24px', overflowY: 'auto' }}>
            {/* Score summary */}
            <div style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: '24px 28px', maxWidth: 480, margin: '0 auto 28px', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', fontWeight: 800, color: '#2a7a7a', lineHeight: 1 }}>
                {correctCount} / {items.length}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#6b7280', marginTop: 6 }}>correct sentences</div>
              {checkedCount < items.length && (
                <div style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: 4 }}>
                  ({items.length - checkedCount} unanswered — time ran out)
                </div>
              )}
            </div>

            {/* Per-item review */}
            <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((it, i) => (
                <div key={it.task_id} style={{
                  background: 'white', border: `2px solid ${!it.checked ? '#e6e8eb' : it.correct ? '#86efac' : '#fca5a5'}`,
                  borderRadius: 10, padding: '14px 18px',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Question {i + 1}</div>
                  <p style={{ fontSize: '0.9rem', color: '#5a2d82', marginBottom: 4 }}>
                    {parseQuestion(it.question).context}
                  </p>
                  {parseQuestion(it.question).template && (
                    <p style={{ fontSize: '0.85rem', color: '#374151', fontFamily: "Georgia, 'Times New Roman', serif", marginBottom: 8 }}>
                      {parseQuestion(it.question).template}
                    </p>
                  )}
                  {it.checked ? (
                    <>
                      <div style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: 3 }}>
                        Your answer: <span style={{ color: it.correct ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                          {it.selected.join(' ') || '—'}
                        </span>
                      </div>
                      {!it.correct && (
                        <div style={{ fontSize: '0.82rem', color: '#2a7a7a' }}>
                          Correct: <span style={{ fontWeight: 600 }}>{it.answer}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: '0.82rem', color: '#9ca3af', fontStyle: 'italic' }}>Not answered</div>
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ maxWidth: 640, margin: '24px auto 0', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.82rem', color: saved ? '#16a34a' : '#9ca3af', fontWeight: 600 }}>
                {saved ? '✓ Saved to dashboard' : 'Saving…'}
              </span>
              <button onClick={() => router.push('/practice/writing/build-a-sentence')}
                style={{ background: 'white', color: '#1f2937', border: '1px solid #e6e8eb', borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}>
                Practice Again
              </button>
              <button onClick={() => router.push('/practice/writing')}
                style={{ background: 'white', color: '#1f2937', border: '1px solid #e6e8eb', borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}>
                Writing Hub
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Exercise screen ──
  return (
    <div style={{ background: '#b0b0b0', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', fontFamily: 'Arial, sans-serif', fontSize: 14 }}>
      <div style={{ width: 1060, maxWidth: '100%', minHeight: '100vh', background: '#e8e8e8', display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <div style={{ background: '#2a7a7a', height: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
          <a href="/practice/writing/build-a-sentence" style={{ color: '#d4e8e8', textDecoration: 'none', fontSize: 14 }}>← Back</a>
          {!started ? (
            <button onClick={() => setStart(true)}
              style={{ background: 'white', color: '#333', border: 'none', padding: '8px 20px', fontSize: 15, fontWeight: 'bold', cursor: 'pointer', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
              Start <span style={{ fontSize: 18, color: '#2a7a7a' }}>›</span>
            </button>
          ) : (
            <button onClick={() => { if (timerRef.current) clearInterval(timerRef.current); setDone(true) }}
              style={{ background: 'white', color: '#333', border: 'none', padding: '8px 20px', fontSize: 15, fontWeight: 'bold', cursor: 'pointer', borderRadius: 3 }}>
              Finish ›
            </button>
          )}
        </div>

        {/* Sub-bar */}
        <div style={{ background: '#f5f5f5', borderBottom: '1px solid #ccc', minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 'bold' }}>Writing</span>
            <span style={{ color: '#999' }}>|</span>
            <span>Question {items.length ? idx + 1 : '–'} of {items.length || 10}</span>
            {group && (
              <>
                <span style={{ color: '#999' }}>|</span>
                <span style={{ color: '#2a7a7a', fontWeight: 600, fontSize: '0.85rem' }}>{group}</span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 'bold', color: timerColor, visibility: timerVis ? 'visible' : 'hidden' }}>
              {fmtTime(seconds)}
            </span>
            <button onClick={() => setTmrVis(v => !v)}
              style={{ color: '#2a7a7a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 'bold', border: 'none', background: 'none', fontSize: 14 }}>
              <svg viewBox="0 0 24 16" style={{ width: 22, height: 14, fill: 'none', stroke: '#2a7a7a', strokeWidth: 1.8 }}>
                <ellipse cx="12" cy="8" rx="11" ry="7" />
                <circle cx="12" cy="8" r="3.5" fill="#2a7a7a" stroke="none" />
              </svg>
              {timerVis ? 'Hide Time' : 'Show Time'}
            </button>
          </div>
        </div>

        {/* Main card */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px' }}>
          {!cur ? (
            <p style={{ color: '#9ca3af' }}>Loading…</p>
          ) : (
            <div style={{ background: 'white', border: '1px solid #ccc', borderRadius: 10, width: '100%', maxWidth: 700, padding: '28px 28px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>

              {/* Progress dots */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                {items.map((it, i) => (
                  <div key={i} style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: i === idx ? '#2a7a7a'
                      : it.checked && it.correct ? '#86efac'
                      : it.checked && !it.correct ? '#fca5a5'
                      : '#e5e7eb',
                    border: i === idx ? '2px solid #1a5a5a' : '2px solid transparent',
                  }} />
                ))}
              </div>

              {/* Question */}
              <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 6 }}>
                Statement / Question
              </p>
              <p style={{ fontSize: '1rem', color: '#5a2d82', lineHeight: 1.6, marginBottom: 12, fontWeight: 500 }}>
                {parseQuestion(cur.question).context}
              </p>
              {parseQuestion(cur.question).template && (
                <>
                  <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                    Complete this sentence
                  </p>
                  <p style={{ fontSize: '0.95rem', color: '#374151', lineHeight: 1.7, marginBottom: 20, fontFamily: "Georgia, 'Times New Roman', serif", background: '#f9fafb', border: '1px solid #e6e8eb', borderRadius: 8, padding: '10px 14px' }}>
                    {parseQuestion(cur.question).template}
                  </p>
                </>
              )}

              {/* Answer tray */}
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                Your sentence
              </p>
              <div style={{
                minHeight: 44, display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16,
                padding: '10px 12px', border: '1.5px dashed', borderRadius: 8,
                borderColor: cur.checked ? (cur.correct ? '#86efac' : '#fca5a5') : '#c8d0d8',
                background: cur.checked ? (cur.correct ? '#f0fdf4' : '#fff5f5') : '#f9fafb',
              }}>
                {cur.selected.length === 0 && (
                  <span style={{ color: '#c0c0c0', fontSize: '0.85rem', alignSelf: 'center' }}>
                    Click words below to build your sentence…
                  </span>
                )}
                {cur.selected.map((w, j) => (
                  <button key={j} onClick={() => !cur.checked && deselectWord(j)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, border: 'none', cursor: cur.checked ? 'default' : 'pointer',
                      background: '#2a7a7a', color: 'white', fontSize: '0.88rem', fontWeight: 600,
                    }}>
                    {w}
                  </button>
                ))}
              </div>

              {/* Word bank */}
              {!cur.checked && (
                <>
                  <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                    Word bank
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 20 }}>
                    {availableWords(cur).map(({ word, available }, j) => (
                      <button key={j} onClick={() => available && selectWord(word)} disabled={!available}
                        style={{
                          padding: '6px 14px', borderRadius: 20, fontSize: '0.88rem', fontWeight: 500,
                          cursor: available ? 'pointer' : 'not-allowed', transition: 'all .12s',
                          border: available ? '1.5px solid #2a7a7a' : '1.5px solid #e0e0e0',
                          color: available ? '#2a7a7a' : '#c0c0c0',
                          background: available ? 'white' : '#f9fafb',
                        }}>
                        {word}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Feedback row */}
              {cur.checked && (
                <div style={{ marginBottom: 16, fontSize: '0.9rem' }}>
                  {cur.correct ? (
                    <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ Correct!</span>
                  ) : (
                    <div>
                      <span style={{ color: '#dc2626', fontWeight: 700 }}>✗ Incorrect</span>
                      <p style={{ marginTop: 4, color: '#2a7a7a', fontSize: '0.88rem' }}>
                        <span style={{ fontWeight: 600 }}>Correct answer:</span> {cur.answer}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {!started ? (
                  <button onClick={() => setStart(true)}
                    style={{ background: '#2a7a7a', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}>
                    Start Timer
                  </button>
                ) : !cur.checked ? (
                  <>
                    <button onClick={checkItem} disabled={cur.selected.length === 0}
                      style={{ background: cur.selected.length ? '#2a7a7a' : '#e5e7eb', color: cur.selected.length ? 'white' : '#9ca3af', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: '0.9rem', cursor: cur.selected.length ? 'pointer' : 'not-allowed' }}>
                      Check
                    </button>
                    <button onClick={resetItem} style={{ fontSize: '0.82rem', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>
                      Reset
                    </button>
                  </>
                ) : (
                  <button onClick={nextItem}
                    style={{ background: '#2a7a7a', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}>
                    {idx + 1 >= items.length ? 'See Results ›' : 'Next →'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function BasGoPage() {
  return <RequireAuth><BasGoContent /></RequireAuth>
}
