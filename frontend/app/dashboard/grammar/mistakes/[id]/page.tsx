'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'
import { AnnotatedSentence } from '@/components/CorrectionPopover'

// ── Types ────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: number
  date: string
  section: string
  task_type: string
  recurrence_count: number
}

interface MurphyUnit {
  murphy_unit: number
  murphy_title: string
}

interface MistakeDetail {
  id: number
  date: string
  grammar_type: string
  sub_type: string | null
  section: string | null
  task_type: string | null
  wrong: string
  correct: string
  explanation: string | null
  reviewed: number
  recurrence_count: number
  remediation_status: string | null
  audio_filename: string | null
  audio_start: number | null
  audio_end: number | null
  history: HistoryEntry[]
  murphy_units: MurphyUnit[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function MetaPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-flex', flexDirection: 'column', gap: 1,
      background: '#f9fafb', border: '1px solid #e5e7eb',
      borderRadius: 8, padding: '6px 12px', minWidth: 80,
    }}>
      <span style={{ fontSize: '0.68rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: color || '#1f2937' }}>{value}</span>
    </span>
  )
}

function SectionBlock({ label, children, labelColor }: { label: string; children: ReactNode; labelColor?: string }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.07em', color: labelColor || '#6b7280', marginBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  )
}

// ── Audio Player ─────────────────────────────────────────────────────────────

function AudioPlayer({ filename, start, end }: { filename: string; start?: number; end?: number }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let url: string | null = null
    fetch(`/api/speaking/recording/${encodeURIComponent(filename)}`, {
      credentials: 'include',
    })
      .then(res => {
        if (!res.ok) throw new Error(`Audio not found (${res.status})`)
        return res.blob()
      })
      .then(blob => { url = URL.createObjectURL(blob); setBlobUrl(url) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [filename])

  // Attach imperative listeners so we can do the webm duration hack
  useEffect(() => {
    const a = audioRef.current
    if (!a || !blobUrl) return

    function onMetadata() {
      if (!a) return
      if (isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration)
        // Seek to window start once duration is known
        if (start != null) a.currentTime = start
      } else {
        // webm files from MediaRecorder lack duration — seek to end to force scan
        a.currentTime = 1e101
      }
    }
    function onDurationChange() {
      if (!a) return
      if (isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration)
        // reset to window start (or 0) after the infinity seek
        if (a.currentTime > a.duration) a.currentTime = start ?? 0
      }
    }
    function onTimeUpdate() {
      if (!a) return
      setCurrent(a.currentTime)
      // Auto-pause at window end
      if (end != null && a.currentTime >= end) {
        a.pause()
        setPlaying(false)
      }
    }
    function onEnded() { setPlaying(false); setCurrent(start ?? 0) }

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
  }, [blobUrl, start, end])

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
    else {
      // If at or past the window end, rewind to start of window
      if (start != null && (end != null && a.currentTime >= end)) {
        a.currentTime = start
      } else if (start != null && a.currentTime < start) {
        a.currentTime = start
      }
      a.play(); setPlaying(true)
    }
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
        {/* segment highlight — red strip between start and end */}
        {start != null && end != null && duration > 0 && isFinite(duration) && (
          <div style={{
            position: 'absolute', top: '50%',
            left: `${(start / duration) * 100}%`,
            width: `${((end - start) / duration) * 100}%`,
            height: 8, borderRadius: 4,
            background: 'rgba(220, 38, 38, 0.35)',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }} />
        )}
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

// ── Main ─────────────────────────────────────────────────────────────────────

function MistakeDetailContent() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<MistakeDetail | null>(null)
  const [err, setErr] = useState('')
  const [marking, setMarking] = useState(false)
  const [markedDone, setMarkedDone] = useState(false)
  const [adjacent, setAdjacent] = useState<{ prev_id: number | null; next_id: number | null }>({ prev_id: null, next_id: null })

  useEffect(() => {
    if (!id) return
    const ac = new AbortController()
    api.get<MistakeDetail>(`/api/grammar/mistakes/${id}`)
      .then(d => { if (!ac.signal.aborted) { setData(d); setMarkedDone(d.reviewed === 1) } })
      .catch(e => { if (!ac.signal.aborted) setErr(e.message) })
    api.get<{ prev_id: number | null; next_id: number | null }>(`/api/grammar/mistakes/${id}/adjacent`)
      .then(d => { if (!ac.signal.aborted) setAdjacent(d) })
      .catch(() => {/* non-critical */})
    return () => ac.abort()
  }, [id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack when user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' && adjacent.prev_id !== null) {
        router.push(`/dashboard/grammar/mistakes/${adjacent.prev_id}`)
      } else if (e.key === 'ArrowRight' && adjacent.next_id !== null) {
        router.push(`/dashboard/grammar/mistakes/${adjacent.next_id}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adjacent, router])

  async function handleMarkReviewed() {
    if (!data || markedDone) return
    setMarking(true)
    try {
      await api.post(`/api/grammar/mistakes/${data.id}/review`, {})
      setMarkedDone(true)
      setData(prev => prev ? { ...prev, reviewed: 1 } : prev)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error marking reviewed')
    } finally {
      setMarking(false)
    }
  }

  if (err) return (
    <><Topbar />
      <div className="db-container">
        <p style={{ color: '#dc2626', padding: '1.5rem' }}>{err}</p>
        <Link href="/dashboard/grammar" style={{ color: 'var(--teal-700)', fontSize: '0.85rem' }}>← Back to Grammar</Link>
      </div>
    </>
  )

  if (!data) return (
    <><Topbar />
      <div className="db-container">
        <p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p>
      </div>
    </>
  )

  const isReviewed = markedDone || data.reviewed === 1
  const isSpeaking = (data.section || '').toLowerCase() === 'speaking'
  const isStrengthened = data.remediation_status === 'engaged' || data.remediation_status === 'mastered'

  return (
    <>
      <Topbar />
      <div className="db-container">

        {/* ── Back ── */}
        <div style={{ marginBottom: '1.2rem' }}>
          <button
            onClick={() => router.back()}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--teal-700)', fontSize: '0.85rem', padding: 0,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            ← Grammar Dashboard
          </button>
        </div>

        {/* ── Header ── */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#1f2937' }}>
              {data.grammar_type}
            </h2>
            {data.sub_type && (
              <span style={{
                background: 'var(--teal-50)', color: 'var(--teal-700)',
                borderRadius: 6, padding: '2px 10px', fontSize: '0.78rem', fontWeight: 600,
              }}>
                {data.sub_type}
              </span>
            )}
            <span className={`badge ${isReviewed ? 'badge-good' : 'badge-mid'}`} style={{ marginLeft: 'auto' }}>
              {isReviewed ? 'Reviewed' : 'Pending Review'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <MetaPill label="Date" value={(data.date || '').slice(0, 10)} />
            <MetaPill label="Section" value={data.section || '—'} />
            <MetaPill label="Task" value={data.task_type || '—'} />
            <MetaPill label="Seen" value={`${data.recurrence_count}×`} color={data.recurrence_count >= 3 ? '#dc2626' : '#b45309'} />
          </div>
        </div>

        {/* ── Wrong / Correct / Explanation / Audio ── */}
        <div className="table-card section-gap" style={{ padding: '1.25rem 1.5rem' }}>
          {isSpeaking && data.audio_filename && (
            <SectionBlock label={data.audio_start != null ? 'Your Recording — Mistake Segment' : 'Your Recording'}>
              <AudioPlayer
                filename={data.audio_filename}
                start={data.audio_start ?? undefined}
                end={data.audio_end ?? undefined}
              />
              {data.audio_start != null && (
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 6 }}>
                  Segment {data.audio_start.toFixed(1)}s – {data.audio_end?.toFixed(1)}s · press play again to replay
                </div>
              )}
            </SectionBlock>
          )}

          {/* Wrong — always visible */}
          <SectionBlock label="Wrong" labelColor="#dc2626">
            <div style={{
              fontSize: '1rem', lineHeight: 1.72, color: '#1c2430',
              background: '#fffcf7', border: '1px solid #e7ded2',
              borderRadius: 18, padding: '18px 18px 20px',
            }}>
              <AnnotatedSentence wrong={data.wrong} correct={data.correct} explanation={data.explanation || undefined} showHighlight={isStrengthened} />
            </div>
          </SectionBlock>

          {/* Correct + Why — locked until "Strengthen This Pattern" is done */}
          <div style={{ position: 'relative' }}>
            {!isStrengthened && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 8, textAlign: 'center', padding: '1rem',
                pointerEvents: 'none',
              }}>
                <span style={{ fontSize: '1.5rem' }}>🔒</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
                  Complete "Strengthen This Pattern" to reveal the solution and reason.
                </span>
              </div>
            )}
            <div style={{
              filter: isStrengthened ? undefined : 'blur(6px)',
              userSelect: isStrengthened ? undefined : 'none',
              pointerEvents: isStrengthened ? undefined : 'none',
              transition: 'filter 0.3s ease',
            }}>
              <SectionBlock label="Correct" labelColor="#16a34a">
                <div style={{
                  fontSize: '1rem', lineHeight: 1.72, color: '#2e3c36',
                  background: '#edf9f1', border: '1px solid #b7e3c4',
                  borderRadius: 18, padding: '18px 18px 20px',
                }}>
                  {data.correct}
                </div>
              </SectionBlock>

              {data.explanation && (
                <SectionBlock label="Why">
                  <div style={{
                    fontSize: '0.9rem', lineHeight: 1.65, color: '#374151',
                    background: '#fffaf2', border: '1px solid #e7ded2',
                    borderRadius: 18, padding: '16px 18px',
                  }}>
                    {data.explanation}
                  </div>
                </SectionBlock>
              )}
            </div>
          </div>
        </div>

        {/* ── Recurrence history ── */}
        {data.history.length > 0 && (
          <>
            <div className="section-title">Recurrence History ({data.history.length})</div>
            <div className="table-card section-gap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Section</th>
                    <th>Task</th>
                    <th className="num">Count at that point</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h, i) => (
                    <tr key={i} style={{ background: h.id === data.id ? 'var(--teal-50)' : undefined }}>
                      <td style={{ color: '#9ca3af' }}>{(h.date || '').slice(0, 10)}</td>
                      <td style={{ textTransform: 'capitalize', color: '#6b7280' }}>{h.section || '—'}</td>
                      <td style={{ color: '#6b7280' }}>{h.task_type || '—'}</td>
                      <td className="num">{h.recurrence_count}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Murphy units ── */}
        {data.murphy_units.length > 0 && (
          <>
            <div className="section-title">Murphy Grammar Units</div>
            <div className="table-card section-gap" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {data.murphy_units.map(u => (
                  <Link
                    key={u.murphy_unit}
                    href={`/learn/${u.murphy_unit}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <div style={{
                      background: 'var(--teal-50)', border: '1px solid var(--teal-700)',
                      borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
                    }}>
                      <div style={{ fontWeight: 700, color: 'var(--teal-700)', fontSize: '0.85rem' }}>
                        Unit {u.murphy_unit}
                      </div>
                      {u.murphy_title && (
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
                          {u.murphy_title}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Actions ── */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '1.5rem 0' }}>
          <button
            onClick={handleMarkReviewed}
            disabled={isReviewed || marking}
            style={{
              background: isReviewed ? '#d1fae5' : 'var(--teal-700)',
              color: isReviewed ? '#15803d' : '#fff',
              border: 'none', borderRadius: 8,
              padding: '0.6rem 1.25rem', fontWeight: 600,
              fontSize: '0.875rem', cursor: isReviewed ? 'default' : 'pointer',
              opacity: marking ? 0.7 : 1,
            }}
          >
            {isReviewed ? '✓ Reviewed' : marking ? 'Saving…' : 'Mark as Reviewed'}
          </button>

          <Link
            href={`/practice/grammar/remediate/${data.id}`}
            style={{
              background: 'var(--teal-700)',
              color: '#fff',
              border: 'none',
              borderRadius: 8, padding: '0.6rem 1.25rem',
              fontWeight: 600, fontSize: '0.875rem',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              textDecoration: 'none',
            }}
          >
            🎯 Strengthen This Pattern
          </Link>

          <Link
            href={`/practice/grammar/mistake/${data.id}`}
            style={{
              background: '#fff', border: '1px solid #e5e7eb',
              borderRadius: 8, padding: '0.6rem 1.25rem',
              fontWeight: 600, fontSize: '0.875rem',
              color: '#374151', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center',
            }}
          >
            Drill This Mistake →
          </Link>
        </div>

        {/* ── Nav ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1rem', marginBottom: '1.5rem' }}>
          {adjacent.prev_id !== null ? (
            <Link
              href={`/dashboard/grammar/mistakes/${adjacent.prev_id}`}
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
              href={`/dashboard/grammar/mistakes/${adjacent.next_id}`}
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
          <Link href="/dashboard/grammar" style={{ color: 'var(--teal-700)', fontSize: '0.82rem', textDecoration: 'none' }}>
            Grammar Dashboard
          </Link>
          <span style={{ color: '#d1d5db' }}>·</span>
          <Link href="/dashboard" style={{ color: '#6b7280', fontSize: '0.82rem', textDecoration: 'none' }}>
            Overview
          </Link>
        </div>

      </div>
    </>
  )
}

export default function MistakeDetailPage() {
  return <RequireAuth><MistakeDetailContent /></RequireAuth>
}
