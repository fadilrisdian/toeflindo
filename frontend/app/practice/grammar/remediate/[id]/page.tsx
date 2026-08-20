'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MistakeData {
  id: number
  grammar_type: string
  sub_type: string | null
  wrong: string
  correct: string
  explanation: string | null
  treatability: 'treatable' | 'untreatable'
  rubric_dimension: string
  section: string | null
  task_type: string | null
  review_stage: number
  remediation_status: string
  review_attempts: ReviewAttempt[]
}

interface ReviewAttempt {
  id: number
  attempt_type: 'self_correct' | 'new_sentence'
  attempt_text: string
  is_correct: number
  feedback: string
  created_at: string
}

interface SelfCorrectResult {
  attempt_id: number
  verdict: 'correct' | 'partial' | 'wrong'
  feedback: string
  rule: string
  contrast_wrong: string
  contrast_correct: string
  model_sentences: string[]
  correct: string
}

interface PromptsResult {
  prompts: string[]
}

interface CheckResult {
  attempt_id: number
  verdict: 'correct' | 'awkward' | 'wrong'
  feedback: string
}

// ── Phases ────────────────────────────────────────────────────────────────────
// step1 → student sees wrong sentence, tries to fix it (or taps to skip)
// step2 → rule/model sentences revealed, student reads
// step3 → student writes 2-3 new sentences
// done  → all steps complete

type Phase = 'loading' | 'error' | 'step1' | 'step1-info' | 'step2' | 'step3' | 'done'

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIMENSION_LABEL: Record<string, string> = {
  grammar: 'Grammar & Language Use',
  vocabulary: 'Vocabulary',
}

const DIMENSION_COLOR: Record<string, string> = {
  grammar: '#1d4ed8',
  vocabulary: '#7c3aed',
}

const VERDICT_COLOR: Record<string, string> = {
  correct: '#15803d',
  partial: '#b45309',
  awkward: '#b45309',
  wrong: '#dc2626',
}

const VERDICT_ICON: Record<string, string> = {
  correct: '✓',
  partial: '~',
  awkward: '≈',
  wrong: '✗',
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 6,
      fontSize: '0.75rem',
      fontWeight: 600,
      background: color + '18',
      color,
      border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: '1.25rem 1.5rem',
      marginBottom: '1.25rem',
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ text, color }: { text: string; color?: string }) {
  return (
    <div style={{
      fontSize: '0.7rem',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      color: color || '#6b7280',
      marginBottom: 6,
    }}>
      {text}
    </div>
  )
}

// ── Mic recorder ──────────────────────────────────────────────────────────────

type RecState = 'idle' | 'recording' | 'transcribing'

function getSupportedMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
  for (const m of candidates) {
    if (!m || MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

function MicRecorder({
  onTranscribed,
  disabled,
  label,
}: {
  onTranscribed: (text: string) => void
  disabled?: boolean
  label?: string
}) {
  const [recState, setRecState] = useState<RecState>('idle')
  const [secs, setSecs] = useState(0)
  const [errMsg, setErrMsg] = useState('')
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  async function start() {
    setErrMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = getSupportedMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      mediaRecRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = handleDone
      rec.start()
      setRecState('recording')
      setSecs(0)
      timerRef.current = setInterval(() => setSecs(s => s + 1), 1000)
    } catch {
      setErrMsg('Microphone access denied.')
    }
  }

  function stop() {
    if (mediaRecRef.current?.state !== 'inactive') mediaRecRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  async function handleDone() {
    setRecState('transcribing')
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    const form = new FormData()
    form.append('audio', blob, 'answer.webm')
    try {
      const res = await fetch('/api/grammar/transcribe', { method: 'POST', body: form, credentials: 'include' })
      const d = await res.json()
      const text: string = d.text || d.transcript || ''
      if (!text) {
        setErrMsg('Could not hear anything — try again.')
        setRecState('idle')
        return
      }
      onTranscribed(text)
    } catch {
      setErrMsg('Transcription failed — try again.')
    }
    setRecState('idle')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {recState === 'idle' && (
        <button
          onClick={start}
          disabled={disabled}
          style={{ ...primaryBtnStyle, opacity: disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          🎤 {label || 'Record your answer'}
        </button>
      )}
      {recState === 'recording' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
          <span style={{ fontSize: '0.88rem', color: '#1f2937', fontWeight: 600 }}>Recording… {secs}s</span>
          <button onClick={stop} style={stopBtnStyle}>⏹ Stop</button>
        </div>
      )}
      {recState === 'transcribing' && (
        <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>Transcribing…</div>
      )}
      {errMsg && <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>{errMsg}</div>}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

function RemediateContent() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('loading')
  const [data, setData] = useState<MistakeData | null>(null)
  const [err, setErr] = useState('')

  // Step 1
  const [attempt1, setAttempt1] = useState('')
  const [draft1, setDraft1] = useState('')
  const [submitting1, setSubmitting1] = useState(false)
  const [step1Result, setStep1Result] = useState<SelfCorrectResult | null>(null)

  // Step 3
  const [prompts, setPrompts] = useState<string[]>([])
  const [loadingPrompts, setLoadingPrompts] = useState(false)
  const [sentences, setSentences] = useState<string[]>(['', '', ''])
  const [drafts, setDrafts] = useState<string[]>(['', '', ''])
  const [checkResults, setCheckResults] = useState<(CheckResult | null)[]>([null, null, null])
  const [checking, setChecking] = useState<boolean[]>([false, false, false])
  const [completingIdx, setCompletingIdx] = useState<number | null>(null)
  const [retryHints, setRetryHints] = useState<(string | null)[]>([null, null, null])

  // Done
  const [completing, setCompleting] = useState(false)

  // Load mistake data
  useEffect(() => {
    if (!id) return
    api.get<MistakeData>(`/api/remediate/${id}`)
      .then(d => {
        setData(d)
        setPhase(d.treatability === 'untreatable' ? 'step1-info' : 'step1')
      })
      .catch(e => { setErr(e.message); setPhase('error') })
  }, [id])

  // Load prompts when entering step3
  useEffect(() => {
    if (phase !== 'step3' || !data || prompts.length > 0) return
    setLoadingPrompts(true)
    api.get<PromptsResult>(`/api/remediate/${id}/prompts`)
      .then(r => { setPrompts(r.prompts); setSentences(r.prompts.map(() => '')) })
      .catch(() => {
        setPrompts([
          `Write a sentence using the correct ${data.grammar_type} pattern.`,
          `Write another sentence using the correct ${data.grammar_type} pattern.`,
          `One more sentence using the correct ${data.grammar_type} pattern.`,
        ])
        setSentences(['', '', ''])
      })
      .finally(() => setLoadingPrompts(false))
  }, [phase, data, id, prompts.length])

  async function handleSelfCorrect(skip = false, textOverride?: string) {
    if (!data) return
    setSubmitting1(true)
    try {
      const result = await api.post<SelfCorrectResult>(`/api/remediate/${id}/self-correct`, {
        attempt_text: skip ? data.correct : (textOverride ?? attempt1.trim()) || data.correct,
        hint_level_used: skip ? 5 : 0,
      })
      setStep1Result(result)
      setPhase('step2')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error')
      setPhase('error')
    } finally {
      setSubmitting1(false)
    }
  }

  async function handleCheckSentence(idx: number) {
    if (!data || !prompts[idx] || !sentences[idx].trim()) return
    const newChecking = [...checking]
    newChecking[idx] = true
    setChecking(newChecking)
    try {
      const result = await api.post<CheckResult>(`/api/remediate/${id}/check`, {
        student_sentence: sentences[idx].trim(),
        prompt: prompts[idx],
      })
      const newResults = [...checkResults]
      newResults[idx] = result
      setCheckResults(newResults)
    } catch {
      const newResults = [...checkResults]
      newResults[idx] = { attempt_id: 0, verdict: 'wrong', feedback: 'Could not check — try again.' }
      setCheckResults(newResults)
    } finally {
      const newChecking = [...checking]
      newChecking[idx] = false
      setChecking(newChecking)
    }
  }

  async function handleComplete() {
    setCompleting(true)
    try {
      await api.post(`/api/remediate/${id}/complete`, {})
      setPhase('done')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error completing')
    } finally {
      setCompleting(false)
    }
  }

  const hasAtLeastOneChecked = checkResults.some((r: CheckResult | null) => r !== null && (r.verdict === 'correct' || r.verdict === 'awkward'))

  // ── Render ─────────────────────────────────────────────────────────────────

  if (phase === 'loading') return (
    <div style={{ padding: '2rem', color: '#6b7280' }}>Loading…</div>
  )

  if (phase === 'error') return (
    <div style={{ padding: '2rem' }}>
      <p style={{ color: '#dc2626' }}>{err}</p>
      <button onClick={() => router.back()} style={backBtnStyle}>← Back</button>
    </div>
  )

  if (!data) return null

  const dimColor = DIMENSION_COLOR[data.rubric_dimension] || '#374151'
  const isWriting = (data.section || '').toLowerCase() !== 'speaking'

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <button onClick={() => router.back()} style={backBtnStyle}>← Back</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#1f2937' }}>
            Strengthen: {data.grammar_type}
          </h1>
          {data.sub_type && (
            <Pill label={data.sub_type} color="var(--teal-700, #2a7a7a)" />
          )}
          <Pill
            label={DIMENSION_LABEL[data.rubric_dimension] || data.rubric_dimension}
            color={dimColor}
          />
          <Pill
            label={data.treatability === 'treatable' ? 'Rule-based' : 'Usage-based'}
            color={data.treatability === 'treatable' ? '#0369a1' : '#9333ea'}
          />
        </div>

        {/* Source badge */}
        {(data.section || data.task_type) && (() => {
          const sec = (data.section || '').toLowerCase()
          const icon = sec === 'speaking' ? '🎤' : sec === 'writing' ? '✏️' : '📝'
          const label = [data.section, data.task_type].filter(Boolean).join(' › ')
          return (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              marginTop: 8, padding: '3px 10px', borderRadius: 6,
              background: '#f3f4f6', border: '1px solid #e5e7eb',
              fontSize: '0.75rem', color: '#6b7280', fontWeight: 500,
            }}>
              <span>{icon}</span>
              <span>From: <strong style={{ color: '#374151' }}>{label}</strong></span>
            </div>
          )
        })()}

        {/* Progress bar */}
        <div style={{ marginTop: '1rem', display: 'flex', gap: 6 }}>
          {(['step1', 'step2', 'step3', 'done'] as const).map((s, i) => {
            const steps = ['step1', 'step1-info', 'step2', 'step3', 'done']
            const stepsBar = ['step1', 'step2', 'step3', 'done']
            const current = Math.max(0, stepsBar.indexOf(
              phase === 'step1-info' ? 'step1' : phase
            ))
            const done = i < current
            const active = i === current
            return (
              <div key={s} style={{
                flex: 1, height: 4, borderRadius: 4,
                background: done ? '#2a7a7a' : active ? '#5aafa5' : '#e5e7eb',
                transition: 'background 0.3s',
              }} />
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          {['Try to fix it', 'See the rule', 'Practice new sentences', 'Complete'].map((l, i) => {
            const stepsBar = ['step1', 'step2', 'step3', 'done']
            const current = stepsBar.indexOf(phase === 'step1-info' ? 'step1' : phase)
            return (
              <span key={i} style={{
                fontSize: '0.65rem',
                color: i <= current ? '#2a7a7a' : '#9ca3af',
                fontWeight: i === current ? 700 : 400,
                flex: 1, textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'center',
              }}>{l}</span>
            )
          })}
        </div>
      </div>

      {/* ── Error sentence (always visible) ── */}
      <Card>
        <SectionLabel text="Pattern to strengthen" color="#dc2626" />
        <div style={{
          fontSize: '1rem', lineHeight: 1.7, color: '#111827',
          background: '#fff8f7', border: '1px solid #fecaca',
          borderRadius: 8, padding: '12px 16px', marginBottom: data.explanation ? 10 : 0,
        }}>
          {data.wrong}
        </div>
        {data.explanation && (
          <div style={{ fontSize: '0.83rem', color: '#6b7280', marginTop: 8, lineHeight: 1.55 }}>
            {data.explanation}
          </div>
        )}
      </Card>

      {/* ── STEP 1-INFO: Untreatable pattern info card ── */}
      {phase === 'step1-info' && (
        <Card style={{ borderColor: '#e9d5ff' }}>
          <SectionLabel text="Usage-based pattern" color="#9333ea" />
          <p style={{ fontSize: '0.88rem', color: '#374151', margin: '0 0 12px', lineHeight: 1.6 }}>
            This is a vocabulary or collocation pattern — best learned through exposure to natural usage.
            There is no single rule to memorize. Here's the correction and model examples.
          </p>
          <button
            onClick={() => handleSelfCorrect(true)}
            disabled={submitting1}
            style={{ ...primaryBtnStyle, opacity: submitting1 ? 0.55 : 1 }}
          >
            {submitting1 ? 'Loading…' : 'See the rule and examples →'}
          </button>
        </Card>
      )}

      {/* ── STEP 1: Self-correct ── */}
      {phase === 'step1' && (
        <Card>
          <SectionLabel text="Step 1 — Try to fix it first" color="#1d4ed8" />
          <p style={{ fontSize: '0.88rem', color: '#374151', marginTop: 0, marginBottom: 12 }}>
            Something is off in the sentence above. {isWriting ? 'Type the corrected version below.' : 'Record yourself saying the corrected version.'}
          </p>
          {attempt1 ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                background: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: 8, padding: '10px 14px',
                fontSize: '0.9rem', color: '#1f2937', lineHeight: 1.6,
              }}>
                {isWriting ? '✏️' : '🎙️'} &ldquo;{attempt1}&rdquo;
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => handleSelfCorrect(false)}
                  disabled={submitting1}
                  style={{ ...primaryBtnStyle, opacity: submitting1 ? 0.55 : 1 }}
                >
                  {submitting1 ? 'Checking…' : 'Submit this answer'}
                </button>
                <button
                  onClick={() => { setAttempt1(''); setDraft1('') }}
                  disabled={submitting1}
                  style={{ ...ghostBtnStyle, opacity: submitting1 ? 0.55 : 1 }}
                >
                  {isWriting ? 'Re-type' : 'Re-record'}
                </button>
              </div>
            </div>
          ) : isWriting ? (
            <div>
              <textarea
                value={draft1}
                onChange={e => setDraft1(e.target.value)}
                disabled={submitting1}
                placeholder="Type the corrected sentence here…"
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1px solid #d1d5db', borderRadius: 8,
                  padding: '8px 12px', fontSize: '0.9rem',
                  color: '#1f2937', lineHeight: 1.6,
                  resize: 'vertical', outline: 'none',
                  fontFamily: 'inherit',
                  opacity: submitting1 ? 0.5 : 1,
                }}
              />
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() => {
                    const text = draft1.trim()
                    if (!text) return
                    setAttempt1(text)
                  }}
                  disabled={!draft1.trim() || submitting1}
                  style={{
                    ...primaryBtnStyle, padding: '7px 16px', fontSize: '0.82rem',
                    opacity: (!draft1.trim() || submitting1) ? 0.5 : 1,
                  }}
                >
                  Submit →
                </button>
              </div>
            </div>
          ) : (
            <MicRecorder
              disabled={submitting1}
              label="Record your corrected sentence"
              onTranscribed={text => {
                setAttempt1(text)
              }}
            />
          )}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => handleSelfCorrect(true)}
              disabled={submitting1}
              style={{ ...ghostBtnStyle, opacity: submitting1 ? 0.55 : 1, fontSize: '0.82rem' }}
            >
              Skip — show me the answer
            </button>
          </div>
        </Card>
      )}

      {/* ── STEP 2: Reveal feedback ── */}
      {(phase === 'step2' || phase === 'step3' || phase === 'done') && step1Result && (
        <Card style={{ borderColor: VERDICT_COLOR[step1Result.verdict] + '44' }}>
          <SectionLabel text="Step 2 — Explicit feedback" color={VERDICT_COLOR[step1Result.verdict]} />

          {/* Self-correct verdict */}
          {step1Result.verdict !== 'correct' || attempt1.trim() ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
              padding: '8px 12px', borderRadius: 8,
              background: VERDICT_COLOR[step1Result.verdict] + '12',
            }}>
              <span style={{ fontWeight: 700, fontSize: '1.1rem', color: VERDICT_COLOR[step1Result.verdict] }}>
                {VERDICT_ICON[step1Result.verdict]}
              </span>
              <span style={{ fontSize: '0.88rem', color: '#374151' }}>
                {step1Result.feedback || (step1Result.verdict === 'correct'
                ? 'Correct — grammar applied accurately.'
                : 'Not correct — check the grammar pattern.')}
              </span>
            </div>
          ) : null}

          {/* Correct version */}
          <div style={{ marginBottom: 12 }}>
            <SectionLabel text="Correct version" color="#15803d" />
            <div style={{
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: 8, padding: '10px 14px',
              fontSize: '0.95rem', color: '#166534', lineHeight: 1.65,
            }}>
              {step1Result.correct}
            </div>
          </div>

          {/* Rule (treatable) */}
          {step1Result.rule && (
            <div style={{ marginBottom: 12 }}>
              <SectionLabel text="Rule" color="#1d4ed8" />
              <div style={{
                background: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: 8, padding: '10px 14px',
                fontSize: '0.88rem', color: '#1e3a8a', lineHeight: 1.65,
              }}>
                {step1Result.rule}
              </div>
            </div>
          )}

          {/* Compare — wrong vs correct contrast */}
          {step1Result.contrast_wrong && step1Result.contrast_correct && (
            <div style={{ marginBottom: 12 }}>
              <SectionLabel text="Compare" color="#374151" />
              <div style={{
                background: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: 8, padding: '10px 14px',
                fontSize: '0.88rem', lineHeight: 1.8,
              }}>
                <div>
                  <span style={{ color: '#6b7280', fontWeight: 600, marginRight: 6 }}>Wrong:</span>
                  <span style={{
                    background: '#fef2f2', color: '#dc2626',
                    borderRadius: 4, padding: '1px 6px',
                    fontStyle: 'italic',
                  }}>
                    {step1Result.contrast_wrong}
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: '#6b7280', fontWeight: 600, marginRight: 6 }}>Correct:</span>
                  <span style={{
                    background: '#f0fdf4', color: '#15803d',
                    borderRadius: 4, padding: '1px 6px',
                    fontStyle: 'italic',
                  }}>
                    {step1Result.contrast_correct}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Model sentences (untreatable) */}
          {step1Result.model_sentences.length > 0 && (
            <div>
              <SectionLabel text="Natural usage — model sentences" color="#7c3aed" />
              {step1Result.model_sentences.map((s, i) => (
                <div key={i} style={{
                  background: '#faf5ff', border: '1px solid #e9d5ff',
                  borderRadius: 8, padding: '8px 14px', marginBottom: 6,
                  fontSize: '0.88rem', color: '#4c1d95', lineHeight: 1.65,
                }}>
                  {s}
                </div>
              ))}
            </div>
          )}

          {phase === 'step2' && (
            <div style={{ marginTop: 14 }}>
              <button onClick={() => setPhase('step3')} style={primaryBtnStyle}>
                Continue to practice →
              </button>
            </div>
          )}
        </Card>
      )}

      {/* ── STEP 3: Generation practice ── */}
      {(phase === 'step3' || phase === 'done') && (
        <Card>
          <SectionLabel
            text={isWriting ? 'Step 3 — Write new sentences' : 'Step 3 — Speak new sentences'}
            color="#7c3aed"
          />
          <p style={{ fontSize: '0.88rem', color: '#374151', marginTop: 0, marginBottom: 14 }}>
            {isWriting
              ? 'Type a NEW sentence for each prompt — use your own content, don\'t repeat the original.'
              : 'Speak a NEW sentence for each prompt — use your own content, don\'t repeat the original.'}
          </p>

          {loadingPrompts ? (
            <div style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Generating prompts…</div>
          ) : (
            prompts.map((prompt, i) => (
              <div key={i} style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: '0.82rem', fontWeight: 600, color: '#374151',
                  marginBottom: 8, lineHeight: 1.5,
                }}>
                  {i + 1}. {prompt}
                </div>
                {sentences[i] ? (
                  <div>
                    <div style={{
                      background: '#f9fafb', border: checkResults[i]
                        ? `1px solid ${VERDICT_COLOR[checkResults[i]!.verdict]}88`
                        : '1px solid #e5e7eb',
                      borderRadius: 8, padding: '8px 12px',
                      fontSize: '0.9rem', color: '#1f2937', lineHeight: 1.6,
                    }}>
                      {isWriting ? '✏️' : '🎙️'} &ldquo;{sentences[i]}&rdquo;
                    </div>
                    {checkResults[i] ? (
                      <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{
                          flex: 1, padding: '6px 10px', borderRadius: 6,
                          background: VERDICT_COLOR[checkResults[i]!.verdict] + '12',
                          display: 'flex', gap: 6, alignItems: 'flex-start',
                        }}>
                          <span style={{ fontWeight: 700, color: VERDICT_COLOR[checkResults[i]!.verdict], fontSize: '0.85rem' }}>
                            {VERDICT_ICON[checkResults[i]!.verdict]}
                          </span>
                          <span style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.5 }}>
                            {checkResults[i]!.feedback || (checkResults[i]!.verdict === 'correct'
                              ? 'Correct — pattern applied accurately.'
                              : checkResults[i]!.verdict === 'awkward'
                              ? 'Grammar correct — see the natural phrasing note above.'
                              : 'Incorrect — check the target pattern and try again.')}
                          </span>
                        </div>
                        {phase === 'step3' && (
                          <button
                            onClick={() => {
                              // carry wrong feedback as a retry hint before clearing
                              if (checkResults[i]?.verdict === 'wrong' && checkResults[i]?.feedback) {
                                const nh = [...retryHints]; nh[i] = checkResults[i]!.feedback; setRetryHints(nh)
                              }
                              const ns = [...sentences]; ns[i] = ''; setSentences(ns)
                              const nd = [...drafts]; nd[i] = ''; setDrafts(nd)
                              const nr = [...checkResults]; nr[i] = null; setCheckResults(nr)
                            }}
                            style={{ ...ghostBtnStyle, padding: '5px 12px', fontSize: '0.78rem', flexShrink: 0 }}
                          >
                            {isWriting ? 'Re-type' : 'Re-record'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          onClick={() => handleCheckSentence(i)}
                          disabled={checking[i] || phase === 'done'}
                          style={{
                            ...primaryBtnStyle, padding: '7px 16px', fontSize: '0.82rem',
                            opacity: (checking[i] || phase === 'done') ? 0.5 : 1,
                          }}
                        >
                          {checking[i] ? 'Checking…' : 'Check →'}
                        </button>
                        <button
                          onClick={() => {
                            const ns = [...sentences]; ns[i] = ''; setSentences(ns)
                            const nd = [...drafts]; nd[i] = ''; setDrafts(nd)
                          }}
                          style={{ ...ghostBtnStyle, padding: '5px 12px', fontSize: '0.78rem' }}
                        >
                          {isWriting ? 'Re-type' : 'Re-record'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : isWriting ? (
                  <div>
                    {retryHints[i] && (
                      <div style={{
                        background: '#fffbeb', border: '1px solid #fcd34d',
                        borderRadius: 6, padding: '7px 12px', marginBottom: 8,
                        fontSize: '0.8rem', color: '#92400e', lineHeight: 1.5,
                      }}>
                        <span style={{ fontWeight: 600 }}>Hint: </span>{retryHints[i]}
                      </div>
                    )}
                    <textarea
                      value={drafts[i]}
                      onChange={e => {
                        const nd = [...drafts]; nd[i] = e.target.value; setDrafts(nd)
                      }}
                      disabled={phase === 'done'}
                      placeholder="Type your sentence here…"
                      rows={3}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        border: '1px solid #d1d5db', borderRadius: 8,
                        padding: '8px 12px', fontSize: '0.9rem',
                        color: '#1f2937', lineHeight: 1.6,
                        resize: 'vertical', outline: 'none',
                        fontFamily: 'inherit',
                        opacity: phase === 'done' ? 0.5 : 1,
                      }}
                    />
                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={() => {
                          const text = drafts[i].trim()
                          if (!text) return
                          const ns = [...sentences]; ns[i] = text; setSentences(ns)
                          const nr = [...checkResults]; nr[i] = null; setCheckResults(nr)
                          // clear hint on new attempt
                          const nh = [...retryHints]; nh[i] = null; setRetryHints(nh)
                        }}
                        disabled={!drafts[i].trim() || phase === 'done'}
                        style={{
                          ...primaryBtnStyle, padding: '7px 16px', fontSize: '0.82rem',
                          opacity: (!drafts[i].trim() || phase === 'done') ? 0.5 : 1,
                        }}
                      >
                        Submit →
                      </button>
                    </div>
                  </div>
                ) : (
                  <MicRecorder
                    disabled={phase === 'done'}
                    label="Record your sentence"
                    onTranscribed={text => {
                      const ns = [...sentences]; ns[i] = text; setSentences(ns)
                      const nr = [...checkResults]; nr[i] = null; setCheckResults(nr)
                      // clear hint on new attempt
                      const nh = [...retryHints]; nh[i] = null; setRetryHints(nh)
                    }}
                  />
                )}
              </div>
            ))
          )}

          {phase === 'step3' && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={handleComplete}
                disabled={completing || !hasAtLeastOneChecked}
                style={{
                  ...primaryBtnStyle,
                  opacity: (completing || !hasAtLeastOneChecked) ? 0.5 : 1,
                }}
              >
                {completing ? 'Saving…' : 'Mark as complete ✓'}
              </button>
              {!hasAtLeastOneChecked && (
                <span style={{ marginLeft: 10, fontSize: '0.78rem', color: '#9ca3af' }}>
                  Check at least one sentence first.
                </span>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── DONE ── */}
      {phase === 'done' && (
        <Card style={{ borderColor: '#86efac', background: '#f0fdf4' }}>
          <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎯</div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#15803d', marginBottom: 6 }}>
              Pattern strengthened!
            </div>
            <div style={{ fontSize: '0.85rem', color: '#166534', marginBottom: 16 }}>
              This error will be re-surfaced in a future practice session so you can confirm it's gone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => router.push(`/dashboard/grammar/mistakes/${id}`)}
                style={primaryBtnStyle}
              >
                View mistake detail
              </button>
              <button
                onClick={() => router.push('/practice/grammar')}
                style={ghostBtnStyle}
              >
                Grammar hub
              </button>
            </div>
          </div>
        </Card>
      )}

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

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

const stopBtnStyle: React.CSSProperties = {
  background: '#ef4444', color: '#fff',
  border: 'none', borderRadius: 8, padding: '0.45rem 1rem',
  fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
}

export default function RemediatePage() {
  return <RequireAuth><RemediateContent /></RequireAuth>
}
