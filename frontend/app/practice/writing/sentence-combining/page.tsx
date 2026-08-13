'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

const CONNECTORS = [
  'although', 'because', 'while', 'which', 'in order to',
  'despite', 'since', 'whereas', 'however', 'even though',
]

type Exercise = {
  sentences: string[]
  connectors: string[]
  model_answer: string
  target_clauses: number
}

type Result = {
  correct: boolean
  clause_count: number
  feedback: string
  error_type: string | null
}

type Phase = 'idle' | 'loading' | 'ready' | 'submitting' | 'done'

function SentenceCombiningContent() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [connector, setConnector] = useState('')
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [showModel, setShowModel] = useState(false)
  const [error, setError] = useState('')

  const loadExercise = useCallback(async () => {
    setPhase('loading')
    setResult(null)
    setAnswer('')
    setConnector('')
    setShowModel(false)
    setError('')
    try {
      const data = await api.get<Exercise>('/api/focus-drills/sentence-combining/generate')
      setExercise(data)
      setPhase('ready')
    } catch {
      setError('Could not generate exercise. Please try again.')
      setPhase('idle')
    }
  }, [])

  useEffect(() => { loadExercise() }, [loadExercise])

  async function handleSubmit() {
    if (!exercise || !answer.trim() || !connector) return
    setPhase('submitting')
    try {
      const data = await api.post<Result>('/api/focus-drills/sentence-combining/evaluate', {
        sentences: exercise.sentences,
        user_answer: answer.trim(),
        connector_used: connector,
      })
      setResult(data)
      setPhase('done')
    } catch {
      setError('Evaluation failed. Please try again.')
      setPhase('ready')
    }
  }

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '40px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24, fontSize: '0.78rem', color: '#6b7280' }}>
          <Link href="/practice" style={{ color: '#6b7280', textDecoration: 'none' }}>Practice</Link>
          <span>/</span>
          <Link href="/practice/writing" style={{ color: '#6b7280', textDecoration: 'none' }}>Writing</Link>
          <span>/</span>
          <span style={{ color: '#1f2937', fontWeight: 600 }}>Sentence Combining</span>
        </div>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1f2937', marginBottom: 4 }}>Sentence Combining</h1>
          <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>
            Combine 3 short sentences into one complex sentence using a connector chip.
          </p>
        </div>

        {error && (
          <div style={{ background: '#fce4ec', border: '1px solid #f48fb1', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.82rem', color: '#c62828' }}>
            {error}
          </div>
        )}

        {(phase === 'loading') && (
          <div style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: '0.88rem' }}>
            Generating exercise…
          </div>
        )}

        {exercise && phase !== 'loading' && (
          <div style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            {/* Sentences */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', marginBottom: 10 }}>Combine these sentences</div>
              {exercise.sentences.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 700, marginTop: 2, minWidth: 16 }}>{i + 1}.</span>
                  <span style={{ fontSize: '0.92rem', color: '#374151', lineHeight: 1.5 }}>{s}</span>
                </div>
              ))}
            </div>

            {/* Connector chips */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', marginBottom: 8 }}>Choose a connector</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {exercise.connectors.map(c => (
                  <button key={c} onClick={() => setConnector(c)} disabled={phase === 'done'}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: '0.82rem', fontWeight: 600,
                      border: connector === c ? '1.5px solid #2a7a7a' : '1px solid #e0e0e0',
                      background: connector === c ? '#eaf5f3' : 'white',
                      color: connector === c ? '#2a7a7a' : '#374151',
                      cursor: phase === 'done' ? 'default' : 'pointer',
                      transition: 'all 0.12s',
                    }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Answer textarea */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', marginBottom: 8 }}>Your combined sentence</div>
              <textarea
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                disabled={phase === 'done' || phase === 'submitting'}
                placeholder="Write your combined sentence here…"
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                  border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.92rem',
                  lineHeight: 1.5, resize: 'vertical', outline: 'none',
                  color: '#1f2937', background: phase === 'done' ? '#f9fafb' : 'white',
                }}
              />
            </div>

            {/* Submit */}
            {phase !== 'done' && (
              <button onClick={handleSubmit}
                disabled={!answer.trim() || !connector || phase === 'submitting'}
                style={{
                  background: !answer.trim() || !connector ? '#e5e7eb' : '#2a7a7a',
                  color: !answer.trim() || !connector ? '#9ca3af' : 'white',
                  border: 'none', borderRadius: 8, padding: '10px 24px',
                  fontSize: '0.88rem', fontWeight: 600,
                  cursor: !answer.trim() || !connector ? 'not-allowed' : 'pointer',
                }}>
                {phase === 'submitting' ? 'Checking…' : 'Check my answer'}
              </button>
            )}

            {/* Result */}
            {result && phase === 'done' && (
              <div style={{ marginTop: 20 }}>
                <div style={{
                  padding: '12px 16px', borderRadius: 8, marginBottom: 12,
                  background: result.correct ? '#e8f5e9' : '#fce4ec',
                  border: `1px solid ${result.correct ? '#a5d6a7' : '#f48fb1'}`,
                }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: result.correct ? '#2e7d32' : '#c62828', marginBottom: 4 }}>
                    {result.correct ? '✓ Correct' : '✗ Needs improvement'} · {result.clause_count} clause{result.clause_count !== 1 ? 's' : ''}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.5 }}>{result.feedback}</div>
                </div>

                <button onClick={() => setShowModel(v => !v)}
                  style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 14px', fontSize: '0.8rem', color: '#6b7280', cursor: 'pointer', marginBottom: 12 }}>
                  {showModel ? 'Hide model answer' : 'Show model answer'}
                </button>

                {showModel && (
                  <div style={{ padding: '12px 16px', borderRadius: 8, background: '#f0f9ff', border: '1px solid #bae6fd', fontSize: '0.9rem', color: '#0c4a6e', lineHeight: 1.6, marginBottom: 12 }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: '#0284c7', display: 'block', marginBottom: 4 }}>Model answer</span>
                    {exercise.model_answer}
                  </div>
                )}

                <button onClick={loadExercise}
                  style={{ background: '#2a7a7a', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}>
                  Next exercise
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  )
}

export default function SentenceCombiningPage() {
  return <RequireAuth><SentenceCombiningContent /></RequireAuth>
}
