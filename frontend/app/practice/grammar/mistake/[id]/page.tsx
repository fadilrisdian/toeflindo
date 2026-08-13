'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'
import { AnnotatedSentence } from '@/components/CorrectionPopover'

// ── Mic helpers ───────────────────────────────────────────────────────────────

function getSupportedMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
  for (const m of candidates) { if (!m || MediaRecorder.isTypeSupported(m)) return m }
  return ''
}

const NUM_VA_BARS = 8

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mistake {
  id: number
  grammar_type: string
  sub_type: string | null
  section: string | null
  task_type: string | null
  wrong: string
  correct: string
  explanation: string | null
}

type Phase = 'input' | 'checked'
type Verdict = 'correct' | 'partial' | 'wrong'

// ── Main ──────────────────────────────────────────────────────────────────────

function MistakeDrillContent() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()

  const [mistake, setMistake]     = useState<Mistake | null>(null)
  const [loadErr, setLoadErr]     = useState('')
  const [answer, setAnswer]       = useState('')
  const [phase, setPhase]         = useState<Phase>('input')
  const [verdict, setVerdict]     = useState<Verdict | null>(null)
  const [feedback, setFeedback]   = useState('')
  const [checking, setChecking]   = useState(false)
  const [adjacent, setAdjacent]   = useState<{ prev_id: number | null; next_id: number | null }>({ prev_id: null, next_id: null })

  // Speaking-mode state
  const [inputMode,  setInputMode]  = useState<'type' | 'speak'>('type')
  const [recState,   setRecState]   = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [vaBars,     setVaBars]     = useState<number[]>(new Array(NUM_VA_BARS).fill(0))
  const [micError,   setMicError]   = useState('')

  const streamRef   = useRef<MediaStream | null>(null)
  const mediaRef    = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vaRafRef    = useRef<number | null>(null)
  const vaDataRef   = useRef<Uint8Array<ArrayBuffer> | null>(null)

  useEffect(() => {
    if (!id) return
    api.get<Mistake>(`/api/grammar/mistakes/${id}`)
      .then(setMistake)
      .catch(e => setLoadErr(e.message))
    api.get<{ prev_id: number | null; next_id: number | null }>(`/api/grammar/mistakes/${id}/adjacent`)
      .then(setAdjacent)
      .catch(() => {/* non-critical */})
  }, [id])

  // Stop mic on unmount
  useEffect(() => {
    return () => {
      stopVA()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Voice-activity ────────────────────────────────────────────────────────

  function startVA(stream: MediaStream) {
    try {
      const ctx      = new AudioContext()
      const src      = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      src.connect(analyser)
      analyserRef.current = analyser
      vaDataRef.current   = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
      const tick = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(vaDataRef.current!)
        const data = vaDataRef.current!
        const step = Math.floor(data.length / NUM_VA_BARS)
        setVaBars(Array.from({ length: NUM_VA_BARS }, (_, i) => data[i * step] ?? 0))
        vaRafRef.current = requestAnimationFrame(tick)
      }
      vaRafRef.current = requestAnimationFrame(tick)
    } catch { /* AudioContext unavailable */ }
  }

  function stopVA() {
    if (vaRafRef.current) { cancelAnimationFrame(vaRafRef.current); vaRafRef.current = null }
    analyserRef.current = null
    setVaBars(new Array(NUM_VA_BARS).fill(0))
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  async function startRecording() {
    setMicError('')
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      }
      const stream = streamRef.current
      const mime = getSupportedMime()
      let mr: MediaRecorder
      try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream) }
      catch { mr = new MediaRecorder(stream) }
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(100)
      mediaRef.current = mr
      startVA(stream)
      setRecState('recording')
    } catch {
      setMicError('Microphone access denied. Please allow mic permission and try again.')
    }
  }

  async function stopRecordingAndTranscribe() {
    stopVA()
    const mr = mediaRef.current
    if (!mr || mr.state !== 'recording') { setRecState('idle'); return }
    mediaRef.current = null
    setRecState('transcribing')

    await new Promise<void>(resolve => {
      mr.onstop = () => resolve()
      mr.stop()
    })

    const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
    if (blob.size === 0) { setMicError('Recording was empty — try again.'); setRecState('idle'); return }

    try {
      const fd = new FormData()
      fd.append('audio', blob, 'correction.webm')
      fd.append('wrong', mistake?.wrong || '')
      fd.append('correct', mistake?.correct || '')
      fd.append('category', mistake?.grammar_type || '')
      const res = await fetch('/api/grammar/transcribe-evaluate', {
        method: 'POST', body: fd, credentials: 'include',
      })
      if (res.status === 422) { setMicError('Could not hear anything — try again.'); setRecState('idle'); return }
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const transcript: string = data.transcript || ''
      if (!transcript.trim()) { setMicError('Could not hear anything — try again.'); setRecState('idle'); return }
      setAnswer(transcript.trim())
      setRecState('idle')
      // Result already comes back — skip the extra evaluate call
      setVerdict(data.verdict as Verdict)
      setFeedback(data.feedback || '')
      setPhase('checked')
    } catch (e: unknown) {
      setMicError(e instanceof Error ? e.message : 'Transcription failed')
      setRecState('idle')
    }
  }

  // ── Check logic ───────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' && adjacent.prev_id !== null) {
        router.push(`/practice/grammar/mistake/${adjacent.prev_id}`)
      } else if (e.key === 'ArrowRight' && adjacent.next_id !== null) {
        router.push(`/practice/grammar/mistake/${adjacent.next_id}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adjacent, router])

  async function submitAnswer(text: string) {
    if (!mistake || !text.trim()) return
    setChecking(true)
    try {
      const res = await api.post<{ verdict: string; feedback: string }>(
        '/api/grammar/evaluate',
        { user_answer: text, correct: mistake.correct, wrong: mistake.wrong, category: mistake.grammar_type }
      )
      setVerdict(res.verdict as Verdict)
      setFeedback(res.feedback)
      setPhase('checked')
    } catch (e: unknown) {
      setFeedback(e instanceof Error ? e.message : 'Error checking answer')
    } finally {
      setChecking(false)
    }
  }

  async function handleCheck() {
    await submitAnswer(answer)
  }

  function handleRetry() {
    setAnswer('')
    setVerdict(null)
    setFeedback('')
    setPhase('input')
  }

  // ── Check logic ───────────────────────────────────────────────────────────

  if (loadErr) return (
    <><Topbar />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem' }}>
        <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{loadErr}</p>
        <Link href="/practice/grammar" style={{ color: 'var(--teal-700)', fontSize: '0.85rem' }}>← Grammar Practice</Link>
      </main>
    </>
  )

  if (!mistake) return (
    <><Topbar />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem' }}>
        <p style={{ color: '#6b7280' }}>Loading…</p>
      </main>
    </>
  )

  const verdictColor  = verdict === 'correct' ? '#16a34a' : verdict === 'partial' ? '#b45309' : '#dc2626'
  const verdictBg     = verdict === 'correct' ? '#edf9f1' : verdict === 'partial' ? '#fffbeb' : '#fff5f5'
  const verdictBorder = verdict === 'correct' ? '#b7e3c4' : verdict === 'partial' ? '#fcd34d' : '#fca5a5'
  const verdictLabel  = verdict === 'correct' ? '✓ Correct!' : verdict === 'partial' ? '~ Partially correct' : '✗ Incorrect'

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#9ca3af', marginBottom: '1.5rem' }}>
          <Link href="/practice/grammar" style={{ color: '#6b7280', textDecoration: 'none' }}>Grammar</Link>
          <span>/</span>
          <Link href={`/dashboard/grammar/mistakes/${id}`} style={{ color: '#6b7280', textDecoration: 'none' }}>Mistake #{id}</Link>
          <span>/</span>
          <span style={{ color: '#1f2937', fontWeight: 600 }}>Drill</span>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1f2937' }}>
                {mistake.grammar_type}
              </h1>
              {mistake.sub_type && (
                <span style={{ background: 'var(--teal-50)', color: 'var(--teal-700)', borderRadius: 6, padding: '2px 10px', fontSize: '0.75rem', fontWeight: 600 }}>
                  {mistake.sub_type}
                </span>
              )}
              {mistake.section && (
                <span style={{ background: '#f3f4f6', color: '#6b7280', borderRadius: 6, padding: '2px 10px', fontSize: '0.75rem' }}>
                  {mistake.section}
                </span>
              )}
            </div>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>Fix the mistake in your own words</p>
          </div>

        </div>

        {/* Card */}
        <div className="table-card" style={{ padding: '1.5rem' }}>

          {/* Wrong sentence */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#dc2626', marginBottom: 6 }}>
              Incorrect
            </div>
            <div style={{ fontSize: '1rem', lineHeight: 1.7, color: '#1c2430', background: '#fffcf7', border: '1px solid #e7ded2', borderRadius: 12, padding: '14px 16px' }}>
              {phase === 'checked' && verdict !== 'correct'
                ? <AnnotatedSentence wrong={mistake.wrong} correct={mistake.correct} explanation={mistake.explanation || undefined} />
                : mistake.wrong
              }
            </div>
          </div>

          {/* Input phase */}
          {phase === 'input' && (() => {
            const isSpeaking = (mistake.section || '').toLowerCase() === 'speaking'
            const isRecording   = recState === 'recording'
            const isTranscribing = recState === 'transcribing'
            const busy = isRecording || isTranscribing || checking

            return (
              <div>
                {/* Type / Speak toggle — only for speaking mistakes */}
                {isSpeaking && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                    {(['type', 'speak'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => { setInputMode(m); setMicError('') }}
                        style={{
                          padding: '5px 18px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600,
                          border: `1.5px solid ${inputMode === m ? 'var(--teal-700)' : '#e5e7eb'}`,
                          background: inputMode === m ? 'var(--teal-700)' : '#fff',
                          color: inputMode === m ? '#fff' : '#6b7280',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >
                        {m === 'type' ? '⌨️ Type' : '🎙 Speak'}
                      </button>
                    ))}
                  </div>
                )}

                {/* Type mode */}
                {inputMode === 'type' && (
                  <>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6b7280', marginBottom: 6 }}>
                      Your correction
                    </div>
                    <textarea
                      value={answer}
                      onChange={e => setAnswer(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCheck() } }}
                      rows={3}
                      placeholder="Type the corrected sentence…"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        border: '1px solid #e5e7eb', borderRadius: 10,
                        padding: '10px 14px', fontSize: '0.95rem',
                        outline: 'none', resize: 'none', lineHeight: 1.6,
                        fontFamily: 'inherit', color: '#1f2937',
                        transition: 'border-color 0.15s',
                      }}
                      onFocus={e => { e.target.style.borderColor = '#2a7a7a' }}
                      onBlur={e => { e.target.style.borderColor = '#e5e7eb' }}
                    />
                    <button
                      onClick={handleCheck}
                      disabled={checking || !answer.trim()}
                      style={{
                        marginTop: '0.75rem',
                        background: checking || !answer.trim() ? '#e5e7eb' : 'var(--teal-700)',
                        color: checking || !answer.trim() ? '#9ca3af' : '#fff',
                        border: 'none', borderRadius: 8,
                        padding: '0.6rem 1.5rem', fontWeight: 600,
                        fontSize: '0.875rem', cursor: checking || !answer.trim() ? 'default' : 'pointer',
                        width: '100%',
                      }}>
                      {checking ? 'Checking…' : 'Check Answer'}
                    </button>
                  </>
                )}

                {/* Speak mode */}
                {inputMode === 'speak' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '8px 0' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280', textAlign: 'center' }}>
                      Say the corrected sentence aloud, then press Stop.
                    </p>

                    {/* Mic button */}
                    <button
                      onClick={isRecording ? stopRecordingAndTranscribe : startRecording}
                      disabled={isTranscribing || checking}
                      style={{
                        width: 64, height: 64, borderRadius: '50%', border: 'none',
                        background: isRecording ? '#dc2626' : busy ? '#e5e7eb' : 'var(--teal-700)',
                        color: '#fff', fontSize: 26, cursor: busy ? 'default' : 'pointer',
                        boxShadow: isRecording ? '0 0 0 6px rgba(220,38,38,0.2)' : '0 2px 8px rgba(0,0,0,0.12)',
                        transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                    >
                      {isTranscribing ? '⏳' : isRecording ? '⏹' : '🎙'}
                    </button>

                    {/* Status label */}
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: isRecording ? '#dc2626' : '#9ca3af' }}>
                      {isTranscribing ? 'Transcribing…' : checking ? 'Checking…' : isRecording ? 'Recording… press ⏹ to stop' : 'Press 🎙 to start'}
                    </div>

                    {/* Voice-activity bars */}
                    <div style={{ height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 4 }}>
                      {vaBars.map((level, j) => {
                        const h = isRecording ? Math.max(3, Math.round((level / 255) * 28)) : 3
                        return (
                          <div key={j} style={{
                            width: 5, height: h, borderRadius: 3,
                            background: isRecording ? '#dc2626' : '#e5e7eb',
                            opacity: isRecording ? 0.7 + (level / 255) * 0.3 : 0.4,
                            transition: 'height 0.08s ease-out',
                          }} />
                        )
                      })}
                    </div>

                    {/* Transcribed preview */}
                    {answer && recState === 'idle' && (
                      <div style={{ width: '100%', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', color: '#374151', fontStyle: 'italic' }}>
                        &ldquo;{answer}&rdquo;
                      </div>
                    )}

                    {/* Mic error */}
                    {micError && (
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#dc2626', textAlign: 'center' }}>{micError}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Checked phase */}
          {phase === 'checked' && verdict && (
            <div>
              <div style={{ background: verdictBg, border: `1px solid ${verdictBorder}`, borderRadius: 10, padding: '12px 16px', marginBottom: '1rem' }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: verdictColor }}>{verdictLabel}</p>
                {feedback && <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#374151' }}>{feedback}</p>}
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6b7280', marginBottom: 6 }}>Your answer</div>
                <div style={{ fontSize: '0.95rem', lineHeight: 1.6, color: '#374151', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px' }}>
                  {answer}
                </div>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#16a34a', marginBottom: 6 }}>Correct version</div>
                <div style={{ fontSize: '0.95rem', lineHeight: 1.6, color: '#2e3c36', background: '#edf9f1', border: '1px solid #b7e3c4', borderRadius: 10, padding: '10px 14px' }}>
                  {mistake.correct}
                </div>
              </div>

              {mistake.explanation && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6b7280', marginBottom: 6 }}>Why</div>
                  <div style={{ fontSize: '0.85rem', lineHeight: 1.65, color: '#374151', background: '#fffaf2', border: '1px solid #e7ded2', borderRadius: 10, padding: '10px 14px' }}>
                    {mistake.explanation}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button onClick={handleRetry}
                  style={{ background: 'var(--teal-700)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', flex: 1 }}>
                  Try Again
                </button>
                <Link href={`/practice/grammar/weakspot?category=${encodeURIComponent(mistake.grammar_type)}`}
                  style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', flex: 1, justifyContent: 'center' }}>
                  More {mistake.grammar_type} Drills →
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
          {adjacent.prev_id !== null ? (
            <Link
              href={`/practice/grammar/mistake/${adjacent.prev_id}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '6px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                border: '1px solid #e5e7eb', background: '#fff', color: '#374151',
                textDecoration: 'none',
              }}>
              ← Prev
            </Link>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '6px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
              border: '1px solid #f3f4f6', background: '#f9fafb', color: '#d1d5db',
            }}>
              ← Prev
            </span>
          )}

          {adjacent.next_id !== null ? (
            <Link
              href={`/practice/grammar/mistake/${adjacent.next_id}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '6px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                border: '1px solid #e5e7eb', background: '#fff', color: '#374151',
                textDecoration: 'none',
              }}>
              Next →
            </Link>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '6px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
              border: '1px solid #f3f4f6', background: '#f9fafb', color: '#d1d5db',
            }}>
              Next →
            </span>
          )}

          <span style={{ color: '#d1d5db', marginLeft: 2 }}>·</span>
          <Link href={`/dashboard/grammar/mistakes/${id}`} style={{ color: 'var(--teal-700)', fontSize: '0.82rem', textDecoration: 'none' }}>
            Mistake #{id}
          </Link>
          <span style={{ color: '#d1d5db' }}>·</span>
          <Link href="/dashboard/grammar" style={{ color: '#6b7280', fontSize: '0.82rem', textDecoration: 'none' }}>
            Grammar Dashboard
          </Link>
        </div>

      </main>
    </>
  )
}

export default function MistakeDrillPage() {
  return <RequireAuth><MistakeDrillContent /></RequireAuth>
}
