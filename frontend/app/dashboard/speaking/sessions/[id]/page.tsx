'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

// ── Types ────────────────────────────────────────────────────────────────────

interface GrammarMistake {
  id: number
  grammar_type: string
  sub_type: string
  wrong: string
  correct: string
  explanation: string
  reviewed: number
  recurrence_count: number
}

interface LowConfWord { word: string; confidence: number; time?: number }
interface PitchStats { std_semitones?: number; std_hz?: number; mean?: number; median?: number }
interface VocabDiversity { type_token_ratio?: number }

interface SpeakingSession {
  id: number
  date: string
  section: string
  task_type: string
  prompt: string
  response: string
  score: number
  feedback: string
  duration_minutes: number
  tags: string
  audio_filename: string | null
  transcript: string | null
  overall_score: number | null
  pronunciation_score: number | null
  fluency_score: number | null
  grammar_score: number | null
  vocabulary_score: number | null
  intonation_score: number | null
  wpm: number | null
  cefr_level: string | null
  task_raw_score: number | null
  estimated_band: number | null
  // extended SAL fields
  pause_count?: number | null
  long_pause_count?: number | null
  filler_count?: number | null
  repetition_count?: number | null
  avg_word_confidence?: number | null
  low_confidence_words?: LowConfWord[] | null
  pitch_stats?: PitchStats | null
  energy_variation?: number | null
  vocabulary_diversity?: VocabDiversity | null
  repeated_words?: string[] | null
  grammar_data?: { corrections?: Array<{text: string; correction: string}> } | null
}

// ── Feedback parser ──────────────────────────────────────────────────────────

interface ParsedFeedback {
  summary: string
  strengths: string[]
  weaknesses: string[]
  rest: string
}

function parseFeedback(raw: string): ParsedFeedback {
  const result: ParsedFeedback = { summary: '', strengths: [], weaknesses: [], rest: '' }
  if (!raw) return result

  const strengthsRe = /(?:^|\n)\s*(?:##?\s*)?(?:Strengths?|What (?:you did|went) well|Positive|What worked)[:\s]*\n?/i
  const weaknessRe = /(?:^|\n)\s*(?:##?\s*)?(?:Weaknesses?|Areas? (?:to|for) improv(?:e|ement)|Issues?|To fix|What (?:to )?(?:fix|improve)|Problems?)[:\s]*\n?/i

  let text = raw

  const weakMatch = weaknessRe.exec(text)
  if (weakMatch) {
    const afterHeader = text.slice(weakMatch.index + weakMatch[0].length)
    const nextSection = afterHeader.search(/\n\s*(?:##?\s*)?(?:Strengths?|Polished|Corrected|Model)/i)
    const weakText = nextSection > -1 ? afterHeader.slice(0, nextSection) : afterHeader
    result.weaknesses = extractBullets(weakText)
    text = text.slice(0, weakMatch.index) + (nextSection > -1 ? afterHeader.slice(nextSection) : '')
  }

  const strengthMatch = strengthsRe.exec(text)
  if (strengthMatch) {
    const afterHeader = text.slice(strengthMatch.index + strengthMatch[0].length)
    const nextSection = afterHeader.search(/\n\s*(?:##?\s*)?(?:Weaknesses?|Areas?|To fix|Polished|Corrected|Model)/i)
    const strText = nextSection > -1 ? afterHeader.slice(0, nextSection) : afterHeader
    result.strengths = extractBullets(strText)
    text = text.slice(0, strengthMatch.index) + (nextSection > -1 ? afterHeader.slice(nextSection) : '')
  }

  const remaining = text.trim()
  if (remaining) {
    const firstBreak = remaining.search(/\n\s*\n|\n\s*[-•]/)
    if (firstBreak > 20) {
      result.summary = remaining.slice(0, firstBreak).trim()
      result.rest = remaining.slice(firstBreak).trim()
    } else {
      result.summary = remaining
    }
  }

  return result
}

function extractBullets(text: string): string[] {
  const bullets: string[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*[-•*]\s*(.+)/)
    if (match && match[1].trim()) bullets.push(match[1].trim())
  }
  return bullets
}

// ── Score helpers ────────────────────────────────────────────────────────────

function getScoreTier(score: number, max: number): 'danger' | 'warning' | 'success' {
  const pct = score / max
  if (pct >= 0.8) return 'success'
  if (pct >= 0.5) return 'warning'
  return 'danger'
}

// ── Score bar (clickable) ────────────────────────────────────────────────────

function DimScoreRow({
  label, value, max = 6, isActive, onClick, children,
}: {
  label: string; value: number | null; max?: number
  isActive: boolean; onClick: () => void; children?: React.ReactNode
}) {
  if (value == null) return null
  const pct   = Math.min(100, (value / max) * 100)
  const color = pct >= 75 ? '#27500A' : pct >= 50 ? '#633806' : '#791F1F'
  const bg    = pct >= 75 ? '#EAF3DE' : pct >= 50 ? '#FAEEDA' : '#FCEBEB'
  return (
    <div style={{ marginBottom: isActive ? 4 : 8 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick()}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', borderRadius: 6, padding: '3px 4px', margin: '-3px -4px', transition: 'background 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-0)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ width: 100, fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500, userSelect: 'none' }}>
          {label}
        </span>
        <div style={{ flex: 1, height: 8, background: 'var(--surface-0)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(pct, 3)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
        <span style={{
          width: 36, fontSize: '12px', textAlign: 'right', fontWeight: 600,
          color, background: bg, padding: '1px 6px', borderRadius: 4,
        }}>{Math.round(pct)}%</span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', width: 12, userSelect: 'none' }}>
          {isActive ? '▲' : '▼'}
        </span>
      </div>
      {isActive && children && (
        <div style={{
          margin: '6px 0 10px 8px',
          padding: '10px 14px',
          background: 'var(--surface-0)',
          borderRadius: 8,
          borderLeft: `3px solid ${color}`,
          fontSize: '13px',
          color: 'var(--text-primary)',
          lineHeight: 1.7,
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

function Pill({ text }: { text: string }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: '11px', padding: '1px 8px',
      borderRadius: 12, background: '#f1f0ee', color: 'var(--text-secondary)',
      margin: '2px 3px 2px 0', border: '0.5px solid var(--border)',
    }}>{text}</span>
  )
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function PronunciationDetail({ s }: { s: SpeakingSession }) {
  const conf = s.avg_word_confidence
  const words = s.low_confidence_words
  return (
    <>
      <DetailRow label="Avg word confidence" value={conf != null ? `${Math.round(conf * 100)}%` : null} />
      {words && words.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Unclear words</span>
          {words.slice(0, 12).map((w, i) => <Pill key={i} text={`${w.word} (${Math.round(w.confidence * 100)}%)`} />)}
          {words.length > 12 && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}> +{words.length - 12} more</span>}
        </div>
      )}
      {(!conf && (!words || words.length === 0)) && <span style={{ color: 'var(--text-muted)' }}>No detailed data for this session.</span>}
    </>
  )
}

function FluencyDetail({ s }: { s: SpeakingSession }) {
  const hasData = s.wpm != null || s.pause_count != null || s.filler_count != null || s.repetition_count != null
  if (!hasData) return <span style={{ color: 'var(--text-muted)' }}>No detailed data for this session.</span>
  return (
    <>
      <DetailRow label="Words per minute" value={s.wpm != null ? Math.round(s.wpm) : null} />
      <DetailRow label="Pauses" value={s.pause_count ?? null} />
      <DetailRow label="Long pauses" value={s.long_pause_count ?? null} />
      <DetailRow label="Filler words" value={s.filler_count ?? null} />
      <DetailRow label="Repetitions" value={s.repetition_count ?? null} />
      {s.filler_count != null && s.filler_count > 5 && (
        <div style={{ marginTop: 6, fontSize: '12px', color: '#633806' }}>Tip: reduce filler words like "um" and "uh" — they interrupt fluency.</div>
      )}
      {s.pause_count != null && s.pause_count > 8 && (
        <div style={{ marginTop: 4, fontSize: '12px', color: '#633806' }}>Tip: frequent pausing affects your score — practice with shorter response windows.</div>
      )}
    </>
  )
}

function GrammarDetail({ s, sessionId }: { s: SpeakingSession; sessionId: number }) {
  const corrections = s.grammar_data?.corrections
  return (
    <>
      {corrections && corrections.length > 0
        ? corrections.slice(0, 4).map((c, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <span style={{ color: '#791F1F', textDecoration: 'line-through', marginRight: 6 }}>{c.text}</span>
            <span style={{ color: '#27500A' }}>{c.correction}</span>
          </div>
        ))
        : <span style={{ color: 'var(--text-muted)' }}>No grammar corrections recorded for this session.</span>
      }
      <div style={{ marginTop: 8 }}>
        <a href={`/dashboard/speaking?session=${sessionId}`} style={{ fontSize: '12px', color: 'var(--text-accent)', textDecoration: 'none' }}>
          View grammar mistakes →
        </a>
      </div>
    </>
  )
}

function VocabularyDetail({ s }: { s: SpeakingSession }) {
  const ttr = s.vocabulary_diversity?.type_token_ratio
  const repeated = s.repeated_words
  return (
    <>
      <DetailRow label="CEFR level" value={s.cefr_level ?? null} />
      <DetailRow label="Type-token ratio" value={ttr != null ? `${Math.round(ttr * 100)}%` : null} />
      {repeated && repeated.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Repeated words</span>
          {repeated.slice(0, 10).map((w, i) => <Pill key={i} text={w} />)}
          {repeated.length > 10 && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}> +{repeated.length - 10} more</span>}
        </div>
      )}
      {ttr != null && ttr < 0.5 && (
        <div style={{ marginTop: 6, fontSize: '12px', color: '#633806' }}>Tip: try using more varied vocabulary — aim for a wider range of words.</div>
      )}
      {(!s.cefr_level && !ttr && (!repeated || repeated.length === 0)) && (
        <span style={{ color: 'var(--text-muted)' }}>No detailed data for this session.</span>
      )}
    </>
  )
}

function IntonationDetail({ s }: { s: SpeakingSession }) {
  const stdSt = s.pitch_stats?.std_semitones
  const ev = s.energy_variation
  const hasData = stdSt != null || ev != null
  if (!hasData) return <span style={{ color: 'var(--text-muted)' }}>No detailed data for this session.</span>
  return (
    <>
      <DetailRow label="Pitch variation" value={stdSt != null ? `${stdSt.toFixed(1)} ST` : null} />
      <DetailRow label="Energy variation" value={ev != null ? ev.toFixed(3) : null} />
      {stdSt != null && stdSt < 2 && (
        <div style={{ marginTop: 6, fontSize: '12px', color: '#633806' }}>Tip: your speech sounds monotone (&lt;2 ST). Try emphasising key words and varying pitch.</div>
      )}
      {stdSt != null && stdSt > 6 && (
        <div style={{ marginTop: 6, fontSize: '12px', color: '#27500A' }}>Good: expressive pitch variation detected.</div>
      )}
    </>
  )
}

// ── Audio Player ─────────────────────────────────────────────────────────────

function AudioPlayer({ filename }: { filename: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let url: string | null = null
    fetch(`/api/speaking/recording/${encodeURIComponent(filename)}`, { credentials: 'include' })
      .then(res => { if (!res.ok) throw new Error(`Audio not found (${res.status})`); return res.blob() })
      .then(blob => { url = URL.createObjectURL(blob); setBlobUrl(url) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [filename])

  useEffect(() => {
    const a = audioRef.current
    if (!a || !blobUrl) return

    function onMetadata() {
      if (!a) return
      if (isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration)
      } else {
        a.currentTime = 1e101
      }
    }
    function onDurationChange() {
      if (!a) return
      if (isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration)
        if (a.currentTime > a.duration) a.currentTime = 0
      }
    }
    function onTimeUpdate() {
      if (!a) return
      setCurrent(a.currentTime)
    }
    function onEnded() { setPlaying(false); setCurrent(0) }

    a.addEventListener('loadedmetadata', onMetadata)
    a.addEventListener('durationchange', onDurationChange)
    a.addEventListener('timeupdate', onTimeUpdate)
    a.addEventListener('ended', onEnded)
    return () => {
      a.removeEventListener('loadedmetadata', onMetadata)
      a.removeEventListener('durationchange', onDurationChange)
      a.removeEventListener('timeupdate', onTimeUpdate)
      a.removeEventListener('ended', onEnded)
    }
  }, [blobUrl])

  function fmt(s: number) {
    if (!isFinite(s) || s < 0) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function toggle() {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { a.play().catch(() => { setPlaying(false) }); setPlaying(true) }
  }

  const progress = duration > 0 && isFinite(duration) ? (current / duration) * 100 : 0

  if (loading) return (
    <div style={{ fontSize: '0.82rem', color: '#9ca3af', padding: '0.5rem 0' }}>Loading audio…</div>
  )
  if (error) return (
    <div style={{ fontSize: '0.82rem', color: '#b45309', padding: '0.5rem 0' }}>Audio unavailable: {error}</div>
  )

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      border: '1px solid #e7ded2', background: '#fffaf2',
      borderRadius: 18, padding: '12px 16px',
    }}>
      <audio ref={audioRef} src={blobUrl || undefined} preload="metadata" />

      {/* play / pause button */}
      <button
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        style={{
          width: 40, height: 40, border: 0, borderRadius: '50%',
          background: '#10253d', color: '#fff',
          fontSize: 15, cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {playing ? '⏸' : '▶'}
      </button>

      {/* progress bar */}
      <div
        style={{ flex: 1, position: 'relative', height: 30, cursor: 'pointer' }}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const pct = (e.clientX - rect.left) / rect.width
          if (audioRef.current && duration) {
            audioRef.current.currentTime = pct * duration
            setCurrent(pct * duration)
          }
        }}
      >
        {/* track background */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          height: 4, borderRadius: 4, background: '#e7dfd4', transform: 'translateY(-50%)',
        }} />
        {/* played progress */}
        <div style={{
          position: 'absolute', top: '50%', left: 0,
          height: 4, borderRadius: 4, background: '#10253d', transform: 'translateY(-50%)',
          width: `${progress}%`, transition: 'width 0.1s linear',
        }} />
        {/* thumb */}
        <div style={{
          position: 'absolute', top: '50%',
          left: `${progress}%`, transform: 'translate(-50%, -50%)',
          width: 12, height: 12, borderRadius: '50%', background: '#10253d',
        }} />
      </div>

      {/* time */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#5d6878', flexShrink: 0, minWidth: 68, textAlign: 'right' }}>
        {fmt(current)} / {fmt(duration)}
      </div>
    </div>
  )
}

// ── Main Content ─────────────────────────────────────────────────────────────

function SpeakingSessionContent() {
  const params = useParams()
  const router = useRouter()
  const [session, setSession] = useState<SpeakingSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeDim, setActiveDim] = useState<string | null>(null)
  const [mistakes, setMistakes] = useState<GrammarMistake[]>([])

  useEffect(() => {
    const id = params.id
    if (!id) return
    api.get<SpeakingSession>(`/api/speaking/sessions/${id}`)
      .then(data => setSession(data))
      .catch(err => setError(err.message || 'Session not found'))
      .finally(() => setLoading(false))

    api.get<{ mistakes: GrammarMistake[] }>(`/api/speaking/sessions/${id}/grammar-mistakes`)
      .then(d => setMistakes(d.mistakes ?? []))
      .catch(() => {}) // non-fatal
  }, [params.id])

  if (loading) return <><Topbar /><div className="db-container"><p style={{ color: 'var(--text-muted)' }}>Loading…</p></div></>
  if (error || !session) return (
    <>
      <Topbar />
      <div className="db-container">
       <p style={{ color: 'var(--text-danger)' }}>{error || 'Session not found'}</p>
        <Link href="/dashboard/speaking" style={{ color: 'var(--text-accent)', fontSize: '13px' }}>← Back to Speaking Dashboard</Link>
      </div>
    </>
  )

  const tier = getScoreTier(session.score, 6)
  const fb = parseFeedback(session.feedback)
  const hasAnalysis = session.overall_score != null || session.pronunciation_score != null
  const modeLabel = session.task_type === 'Listen and Repeat' ? 'listen & repeat' : 'interview'

  return (
    <>
      <Topbar />
      <div className="db-container">
       {/* Top row */}
        <div className="ss-top-row">
          <div className="ss-left-group">
            <button onClick={() => router.back()} className="ss-back">←</button>
            <span className="ss-pill">{session.task_type}</span>
            <span className="ss-meta">{session.date.slice(0, 10)}{session.date.length > 10 ? ' ' + session.date.slice(11, 16) : ''}</span>
          </div>
          <div className="ss-left-group">
            {session.cefr_level && <span className="ss-pill">{session.cefr_level}</span>}
            {session.wpm != null && <span className="ss-meta">{Math.round(session.wpm)} WPM</span>}
          </div>
        </div>

        {/* Score banner */}
        <div className={`ss-score-banner ss-score-${tier}`}>
          <div className="ss-score-num">
            <div className="ss-big">{session.score}<small>/6</small></div>
            <div className="ss-score-label">band</div>
            {session.task_raw_score != null && (
              <div style={{ fontSize: '11px', marginTop: 4, opacity: 0.75 }}>
                raw {session.task_raw_score}/5
              </div>
            )}
          </div>
          <p>{fb.summary || 'No summary available.'}</p>
        </div>

        {/* Prompt / Correct answer */}
        {session.prompt && (
          <details className="ss-details" open style={{ marginBottom: '1.5rem' }}>
            <summary>
              <span>{session.task_type === 'Listen and Repeat' ? 'Correct answer' : 'Question'}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>▾</span>
            </summary>
            <p style={{ margin: 0, padding: '0 1.25rem 1.125rem', fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
              {session.prompt}
            </p>
          </details>
        )}

        {/* Your transcript */}
        {(session.response || session.transcript) && (
          <div className="ss-answer-box">
            <div className="ss-answer-label">Your transcript</div>
            <p className="ss-answer-text">&quot;{session.transcript || session.response}&quot;</p>
          </div>
        )}

        {/* Audio */}
        {session.audio_filename && (
          <div style={{ marginBottom: '1.5rem' }}>
            <AudioPlayer filename={session.audio_filename} />
          </div>
        )}

        {/* Dimension scores */}
        {hasAnalysis && (
          <div className="ss-card" style={{ marginBottom: '1.5rem' }}>
            <div className="ss-card-head">Analysis scores</div>
            {/* Raw + band summary row */}
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: 16, flexWrap: 'wrap' }}>
              {session.task_raw_score != null && (
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1 }}>
                    {session.task_raw_score}<span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)' }}>/5 raw</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>task raw score</div>
                </div>
              )}
              {session.estimated_band != null && (
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1 }}>
                    {session.estimated_band}<span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)' }}>/6</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>est. band</div>
                </div>
              )}
              {session.overall_score != null && (
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1 }}>
                    {session.overall_score.toFixed(1)}<span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)' }}>/6</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>acoustic avg</div>
                </div>
              )}
            </div>
            {/* Sub-scores as percentage bars */}
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Sub-scores (acoustic)
            </div>
            <DimScoreRow label="Pronunciation" value={session.pronunciation_score} isActive={activeDim === 'pronunciation'} onClick={() => setActiveDim(activeDim === 'pronunciation' ? null : 'pronunciation')}>
              <PronunciationDetail s={session} />
            </DimScoreRow>
            <DimScoreRow label="Fluency" value={session.fluency_score} isActive={activeDim === 'fluency'} onClick={() => setActiveDim(activeDim === 'fluency' ? null : 'fluency')}>
              <FluencyDetail s={session} />
            </DimScoreRow>
            <DimScoreRow label="Grammar" value={session.grammar_score} isActive={activeDim === 'grammar'} onClick={() => setActiveDim(activeDim === 'grammar' ? null : 'grammar')}>
              <GrammarDetail s={session} sessionId={session.id} />
            </DimScoreRow>
            <DimScoreRow label="Vocabulary" value={session.vocabulary_score} isActive={activeDim === 'vocabulary'} onClick={() => setActiveDim(activeDim === 'vocabulary' ? null : 'vocabulary')}>
              <VocabularyDetail s={session} />
            </DimScoreRow>
            <DimScoreRow label="Intonation" value={session.intonation_score} isActive={activeDim === 'intonation'} onClick={() => setActiveDim(activeDim === 'intonation' ? null : 'intonation')}>
              <IntonationDetail s={session} />
            </DimScoreRow>
          </div>
        )}

        {/* Feedback grid: strengths / weaknesses */}
        {(fb.strengths.length > 0 || fb.weaknesses.length > 0) && (
          <div className="ss-fb-grid">
            {fb.strengths.length > 0 && (
              <div className="ss-fb-card ss-fb-success">
                <div className="ss-fb-head ss-fb-head-success">✓ What worked</div>
                <ul>
                  {fb.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {fb.weaknesses.length > 0 && (
              <div className="ss-fb-card ss-fb-danger">
                <div className="ss-fb-head ss-fb-head-danger">✗ To fix next time</div>
                <ul>
                  {fb.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* General feedback if no structured sections */}
        {fb.strengths.length === 0 && fb.weaknesses.length === 0 && (fb.rest || (!fb.summary && session.feedback)) && (
          <div className="ss-card" style={{ marginBottom: '1.5rem' }}>
            <div className="ss-card-head">Feedback</div>
            <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {fb.rest || session.feedback}
            </div>
          </div>
        )}

        {/* Grammar Mistakes */}
        {mistakes.length > 0 && (
          <div className="ss-card" style={{ marginBottom: '1.5rem' }}>
            <div className="ss-card-head">Grammar mistakes</div>
            <div style={{ padding: 0, overflow: 'hidden', borderRadius: 8, border: '0.5px solid var(--border)' }}>
              <table style={{ tableLayout: 'auto', width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-0)' }}>
                    <th style={{ whiteSpace: 'nowrap', width: '1%', padding: '8px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>Type</th>
                    <th style={{ padding: '8px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>Mistake</th>
                  </tr>
                </thead>
                <tbody>
                  {mistakes.map((m, i) => (
                    <tr
                      key={m.id}
                      onClick={() => router.push(`/dashboard/grammar/mistakes/${m.id}`)}
                      style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#f9fafb')}
                    >
                      <td style={{ whiteSpace: 'nowrap', width: '1%', padding: '8px 12px', verticalAlign: 'middle' }}>
                        <span style={{
                          display: 'inline-block',
                          background: 'var(--teal-50, #e6f4f4)',
                          color: 'var(--teal-700, #2a7a7a)',
                          border: '1px solid #99d1d1',
                          borderRadius: '999px',
                          padding: '0.1rem 0.55rem',
                          fontSize: '0.72rem',
                          fontWeight: 500,
                          lineHeight: 1.6,
                          whiteSpace: 'nowrap',
                        }}>{m.grammar_type}{m.sub_type ? ` · ${m.sub_type}` : ''}</span>
                      </td>
                      <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{ color: '#791F1F', fontStyle: 'italic' }}>✗ {m.wrong}</span>
                          <span style={{ color: '#9ca3af', fontWeight: 600 }}>→</span>
                          <span style={{ color: '#27500A' }}>✓ {m.correct}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="ss-actions">
          <Link href={`/practice/speaking/${session.task_type === 'Listen and Repeat' ? 'listen-repeat' : 'interview'}`} className="ss-btn-primary">
            Practice {modeLabel} again
          </Link>
          <Link href="/dashboard/speaking" className="ss-btn-secondary">
            All speaking sessions
          </Link>
        </div>
      </div>

      <style jsx>{`
        .ss-top-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 1.25rem;
        }
        .ss-left-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ss-back {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          color: var(--text-secondary);
          padding: 4px 8px;
          border-radius: 6px;
        }
        .ss-back:hover { background: var(--surface-0); }
        .ss-pill {
          font-size: 12px;
          font-weight: 500;
          padding: 3px 10px;
          border-radius: 20px;
          background: var(--surface-0);
          color: var(--text-secondary);
          border: 0.5px solid var(--border);
        }
        .ss-meta {
          font-size: 13px;
          color: var(--text-muted);
        }

        /* Score banner */
        .ss-score-banner {
          display: grid;
          grid-template-columns: auto minmax(0,1fr);
          gap: 16px;
          align-items: center;
          border-radius: 12px;
          padding: 1rem 1.25rem;
          margin-bottom: 1.5rem;
        }
        .ss-score-danger { background: #FCEBEB; }
        .ss-score-warning { background: #FAEEDA; }
        .ss-score-success { background: #EAF3DE; }
        .ss-score-num { text-align: center; min-width: 64px; }
        .ss-big {
          font-size: 26px;
          font-weight: 600;
          line-height: 1;
        }
        .ss-big small { font-size: 15px; font-weight: 500; }
        .ss-score-danger .ss-big, .ss-score-danger .ss-score-label, .ss-score-danger p { color: #791F1F; }
        .ss-score-warning .ss-big, .ss-score-warning .ss-score-label, .ss-score-warning p { color: #633806; }
        .ss-score-success .ss-big, .ss-score-success .ss-score-label, .ss-score-success p { color: #27500A; }
        .ss-score-label { font-size: 11px; margin-top: 2px; }
        .ss-score-banner p { margin: 0; font-size: 14px; line-height: 1.5; }

        /* Collapsible */
        .ss-details {
          background: var(--surface-0);
          border: 0.5px dashed #D0CDC2;
          border-radius: 12px;
        }
        .ss-details summary {
          cursor: pointer;
          list-style: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.875rem 1.25rem;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
        }
        .ss-details summary::-webkit-details-marker { display: none; }

        /* Answer box */
        .ss-answer-box {
          background: #fff;
          border: 0.5px solid var(--border);
          border-radius: 12px;
          padding: 1rem 1.25rem;
          margin-bottom: 1.5rem;
        }
        .ss-answer-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
          margin-bottom: 10px;
        }
        .ss-answer-text {
          margin: 0;
          font-size: 14px;
          color: var(--text-primary);
          line-height: 1.7;
          font-family: Georgia, "Times New Roman", serif;
          font-style: italic;
        }

        /* Card */
        .ss-card {
          background: #fff;
          border: 0.5px solid var(--border);
          border-radius: 12px;
          padding: 1rem 1.25rem;
        }
        .ss-card-head {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
          margin-bottom: 12px;
        }

        /* Feedback grid */
        .ss-fb-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0,1fr));
          gap: 12px;
          margin-bottom: 1.5rem;
        }
        .ss-fb-card {
          border-radius: 12px;
          padding: 1rem 1.25rem;
        }
        .ss-fb-success { background: #EAF3DE; }
        .ss-fb-danger { background: #FCEBEB; }
        .ss-fb-head {
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ss-fb-head-success { color: #27500A; }
        .ss-fb-head-danger { color: #791F1F; }
        .ss-fb-card ul {
          margin: 0;
          padding-left: 18px;
          font-size: 13px;
          line-height: 1.8;
        }
        .ss-fb-success ul { color: #27500A; }
        .ss-fb-danger ul { color: #791F1F; }

        /* Actions */
        .ss-actions {
          display: flex;
          gap: 10px;
          margin-top: 1.5rem;
        }
        .ss-btn-primary, .ss-btn-secondary {
          flex: 1;
          height: 40px;
          font-size: 14px;
          font-weight: 500;
          border-radius: 10px;
          cursor: pointer;
          text-decoration: none;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
        }
        .ss-btn-primary {
          background: #1F1E1B;
          color: #fff;
          border: none;
        }
        .ss-btn-primary:hover { opacity: 0.9; }
        .ss-btn-secondary {
          background: #fff;
          color: #1F1E1B;
          border: 0.5px solid #D0CDC2;
        }
        .ss-btn-secondary:hover { background: var(--surface-0); }

        @media (max-width: 520px) {
          .ss-fb-grid { grid-template-columns: 1fr; }
          .ss-actions { flex-direction: column; }
        }
      `}</style>
    </>
  )
}

export default function SpeakingSessionPage() {
  return <RequireAuth><SpeakingSessionContent /></RequireAuth>
}
