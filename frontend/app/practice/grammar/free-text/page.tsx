'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mistake {
  wrong: string
  correct: string
  grammar_type: string
  sub_type: string
  explanation: string
  treatability: 'treatable' | 'untreatable'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TREATABILITY_COLOR: Record<string, string> = {
  treatable: '#0369a1',
  untreatable: '#9333ea',
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 9px',
      borderRadius: 6,
      fontSize: '0.72rem',
      fontWeight: 600,
      background: color + '18',
      color,
      border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  )
}

function MistakeCard({ m, idx }: { m: Mistake; idx: number }) {
  const [expanded, setExpanded] = useState(false)
  const color = TREATABILITY_COLOR[m.treatability] || '#374151'

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 10,
      background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <span style={{
          minWidth: 24, height: 24, borderRadius: '50%',
          background: '#f3f4f6', color: '#6b7280',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
        }}>{idx + 1}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <Pill label={m.grammar_type} color="#2a7a7a" />
            {m.sub_type && <Pill label={m.sub_type} color="#6b7280" />}
            <Pill
              label={m.treatability === 'treatable' ? 'Rule-based' : 'Usage-based'}
              color={color}
            />
          </div>
          {/* Wrong */}
          <div style={{
            background: '#fff8f7', border: '1px solid #fecaca',
            borderRadius: 7, padding: '7px 12px',
            fontSize: '0.88rem', color: '#111827', lineHeight: 1.6,
            marginBottom: 6,
          }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626', marginRight: 6, textTransform: 'uppercase' }}>Error</span>
            {m.wrong}
          </div>
          {/* Correct */}
          <div style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 7, padding: '7px 12px',
            fontSize: '0.88rem', color: '#166534', lineHeight: 1.6,
            marginBottom: 6,
          }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#15803d', marginRight: 6, textTransform: 'uppercase' }}>Fix</span>
            {m.correct}
          </div>
          {/* Explanation toggle */}
          {m.explanation && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#2a7a7a', fontSize: '0.78rem', fontWeight: 600, padding: 0,
              }}
            >
              {expanded ? '▲ Hide explanation' : '▼ Why?'}
            </button>
          )}
          {expanded && m.explanation && (
            <div style={{
              marginTop: 6, padding: '7px 12px',
              background: '#eff6ff', border: '1px solid #bfdbfe',
              borderRadius: 7, fontSize: '0.83rem', color: '#1e3a8a', lineHeight: 1.6,
            }}>
              {m.explanation}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

function FreeTextContent() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [saveMistakes, setSaveMistakes] = useState(true)
  const [loading, setLoading] = useState(false)
  const [mistakes, setMistakes] = useState<Mistake[] | null>(null)
  const [err, setErr] = useState('')

  async function handleSubmit() {
    if (!text.trim()) return
    setLoading(true)
    setErr('')
    setMistakes(null)
    try {
      const res = await api.post<{ mistakes: Mistake[] }>('/api/grammar/analyze-text', {
        text: text.trim(),
        save_mistakes: saveMistakes,
      })
      setMistakes(res.mistakes || [])
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Something went wrong — try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>

      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <button onClick={() => router.back()} style={backBtnStyle}>← Back</button>
        <h1 style={{ margin: '0.75rem 0 4px', fontSize: '1.2rem', fontWeight: 700, color: '#1f2937' }}>
          Free Text Analysis
        </h1>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
          Paste or type any text. The AI will find grammar mistakes and explain them.
        </p>
      </div>

      {/* Input card */}
      <div style={cardStyle}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6b7280', marginBottom: 8 }}>
          Your text
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={loading}
          placeholder="Paste or type a paragraph here…"
          rows={6}
          style={{
            width: '100%', boxSizing: 'border-box',
            border: '1px solid #d1d5db', borderRadius: 8,
            padding: '10px 14px', fontSize: '0.9rem',
            color: '#1f2937', lineHeight: 1.6,
            resize: 'vertical', outline: 'none',
            fontFamily: 'inherit',
            opacity: loading ? 0.6 : 1,
          }}
        />

        {/* Save toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={saveMistakes}
            onChange={e => setSaveMistakes(e.target.checked)}
            disabled={loading}
            style={{ accentColor: '#2a7a7a', width: 15, height: 15 }}
          />
          <span style={{ fontSize: '0.82rem', color: '#374151' }}>
            Save mistakes to my grammar log
          </span>
        </label>

        <div style={{ marginTop: 14 }}>
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || loading}
            style={{
              ...primaryBtnStyle,
              opacity: (!text.trim() || loading) ? 0.5 : 1,
            }}
          >
            {loading ? 'Analyzing…' : 'Analyze →'}
          </button>
        </div>
      </div>

      {/* Error */}
      {err && (
        <div style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: 12 }}>{err}</div>
      )}

      {/* Results */}
      {mistakes !== null && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
          }}>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1f2937' }}>
              {mistakes.length === 0
                ? '✓ No grammar mistakes found'
                : `${mistakes.length} mistake${mistakes.length !== 1 ? 's' : ''} found`}
            </span>
            {saveMistakes && mistakes.length > 0 && (
              <span style={{ fontSize: '0.75rem', color: '#2a7a7a', fontWeight: 600 }}>
                · saved to your log
              </span>
            )}
          </div>

          {mistakes.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', color: '#15803d', fontWeight: 600 }}>
              🎉 Great job! Your text looks clean.
            </div>
          ) : (
            <>
              {mistakes.map((m, i) => (
                <MistakeCard key={i} m={m} idx={i} />
              ))}
              {saveMistakes && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => router.push('/practice/grammar')}
                    style={ghostBtnStyle}
                  >
                    Practice these mistakes →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '1.25rem 1.5rem',
  marginBottom: '1.25rem',
}

const backBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--teal-700, #2a7a7a)', fontSize: '0.85rem', padding: 0,
  display: 'inline-flex', alignItems: 'center', gap: 4,
}

const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--teal-700, #2a7a7a)', color: '#fff',
  border: 'none', borderRadius: 8, padding: '0.55rem 1.2rem',
  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
}

const ghostBtnStyle: React.CSSProperties = {
  background: '#fff', color: '#374151',
  border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.55rem 1.2rem',
  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
}

export default function FreeTextPage() {
  return <RequireAuth><FreeTextContent /></RequireAuth>
}
