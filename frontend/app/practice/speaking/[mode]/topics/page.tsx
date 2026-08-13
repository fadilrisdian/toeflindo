'use client'

import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

interface Task { task_id: number; question: string; task_type: string; tags?: string }
interface TasksResp { rows: Task[] }
interface HistRow {
  task_type: string; score: number; tags?: string
  audio_filename?: string | null; date?: string; feedback?: string; response?: string
}
interface HistResp { rows: HistRow[]; total: number }

const MODE_TASK: Record<string, string> = {
  'listen-and-repeat': 'Listen and Repeat',
  'interview':         'Take an Interview',
}

function prettySlug(tags: string): string {
  const parts = tags.split(',')
  const slug = parts[parts.length - 1] || parts[0]
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

interface TopicCard {
  tags: string
  name: string
  firstTaskId: number
  count: number
  practiced: number
  avg: number | null
  // Latest session with a recording (for playback)
  latestAudio: string | null
  latestDate: string | null
  latestScore: number | null
  latestTranscript: string | null
  latestFeedback: string | null
}

function scoreStyle(avg: number | null): React.CSSProperties {
  if (avg == null) return {}
  if (avg >= 4.5) return { background: '#e7f7ec', color: '#16a34a' }
  if (avg >= 3.0) return { background: '#fef3e2', color: '#b45309' }
  return { background: '#fdeaea', color: '#dc2626' }
}

// Modal for past recording playback
function RecordingModal({
  card, onClose, token, mode,
}: {
  card: TopicCard
  onClose: () => void
  token: string
  mode: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)

  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 60 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 10, maxWidth: 560, width: '94vw', padding: '28px 28px 24px', position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af', lineHeight: 1 }}>×</button>

        <div style={{ fontFamily: 'Arial, sans-serif' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e7373', marginBottom: 4 }}>{card.name}</div>
          <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 16 }}>
            {card.latestDate}  ·  Score: <strong style={{ color: card.latestScore != null && card.latestScore >= 4 ? '#16a34a' : card.latestScore != null && card.latestScore >= 3 ? '#b45309' : '#dc2626' }}>{card.latestScore}/6</strong>
          </div>

          {/* Audio player */}
          {card.latestAudio ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 6 }}>Your Recording</div>
              <audio
                ref={audioRef}
                controls
                src={`/api/speaking/recording/${card.latestAudio}`}
                style={{ width: '100%', height: 36 }}
              />
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 16 }}>No recording saved for this session.</div>
          )}

          {/* Transcript */}
          {card.latestTranscript && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 4 }}>Your Transcript</div>
              <div style={{ fontSize: '0.84rem', fontStyle: 'italic', color: '#374151', lineHeight: 1.5 }}>&quot;{card.latestTranscript}&quot;</div>
            </div>
          )}

          {/* Feedback */}
          {card.latestFeedback && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 4 }}>AI Feedback</div>
              <div style={{ fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.5 }}>{card.latestFeedback}</div>
            </div>
          )}

          {/* Practice again button — uses mode param directly, not tag heuristic */}
          <Link
            href={`/practice/speaking/${mode}/go?tags=${encodeURIComponent(card.tags)}`}
            style={{
              display: 'inline-block', marginTop: 20, padding: '8px 20px',
              background: '#1e7373', color: '#fff', borderRadius: 6,
              textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600,
            }}
          >
            Practice Again →
          </Link>
        </div>
      </div>
    </div>
  )
}

function TopicsContent({ mode }: { mode: string }) {
  const taskType = MODE_TASK[mode] ?? ''
  const [topics,  setTopics]  = useState<TopicCard[]>([])
  const [loading, setLoad]    = useState(true)
  const [modal,   setModal]   = useState<TopicCard | null>(null)
  const [token,   setToken]   = useState('')

  // Get auth token — no longer needed since we use httpOnly cookie via credentials:'include'
  useEffect(() => {
    setToken('')
  }, [])

  useEffect(() => {
    const histEndpoint = mode === 'interview' ? '/api/speaking/interview' : '/api/speaking/listen-repeat'
    Promise.all([
      api.get<TasksResp>('/api/task/bank', { task_type: taskType, page_size: 500 }),
      api.get<HistResp>(histEndpoint, { page_size: 1000 }).catch(() => ({ rows: [], total: 0 })),
    ]).then(([tasksResp, histResp]) => {
      const tasks = tasksResp.rows
      const hist  = (histResp as HistResp).rows ?? []

      // Group tasks by tags
      const topicMap = new Map<string, { firstId: number; count: number }>()
      tasks.forEach(t => {
        const tag = t.tags || `task-${t.task_id}`
        if (!topicMap.has(tag)) {
          topicMap.set(tag, { firstId: t.task_id, count: 0 })
        }
        topicMap.get(tag)!.count++
      })

      // Build score history + latest recording per tag
      const scoresByTag: Record<string, number[]> = {}
      // Latest session per tag (hist is sorted DESC by date from API)
      const latestByTag: Record<string, HistRow> = {}

      hist.forEach(r => {
        const tag = r.tags || ''
        if (!tag) return
        if (!scoresByTag[tag]) scoresByTag[tag] = []
        if (r.score != null) scoresByTag[tag].push(r.score)
        // latestByTag: prefer most recent session that has a NEW-format recording (rec_*.webm)
        // Old format (aud_*.ogg) was from v1 speech-analyzer — files no longer exist on disk
        if (!latestByTag[tag]) {
          latestByTag[tag] = r
        } else if (r.audio_filename?.startsWith('rec_') && !latestByTag[tag].audio_filename?.startsWith('rec_')) {
          // Upgrade to a session with a persisted recording
          latestByTag[tag] = r
        }
      })

      const cards: TopicCard[] = Array.from(topicMap.entries()).map(([tags, { firstId, count }]) => {
        const scores = scoresByTag[tags] || []
        const avg = scores.length
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100
          : null
        const latest = latestByTag[tags] || null
        return {
          tags,
          name: prettySlug(tags),
          firstTaskId: firstId,
          count,
          practiced: scores.length,
          avg,
          latestAudio:      latest?.audio_filename || null,
          latestDate:       latest?.date?.slice(0, 10) || null,
          latestScore:      latest?.score ?? null,
          latestTranscript: latest?.response || null,
          latestFeedback:   latest?.feedback || null,
        }
      })

      // Sort: weakest practiced topics first (lowest avg → most practice needed), then new
      const practiced = cards.filter(c => c.practiced > 0).sort((a, b) => (a.avg || 0) - (b.avg || 0))
      const newCards   = cards.filter(c => c.practiced === 0)
      setTopics([...practiced, ...newCards])
    }).finally(() => setLoad(false))
  }, [taskType])

  if (loading) return <><Topbar /><p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p></>

  const practiced = topics.filter(c => c.practiced > 0)
  const newCards  = topics.filter(c => c.practiced === 0)

  function Card({ c }: { c: TopicCard }) {
    const sStyle = scoreStyle(c.avg)
    const href   = `/practice/speaking/${mode}/go?tags=${encodeURIComponent(c.tags)}`
    const hasAudio = !!c.latestAudio
    return (
      <div style={{ position: 'relative' }}>
        <Link href={href}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            padding: '22px 16px 14px', border: '1px solid #e6e8eb', borderRadius: 12,
            textDecoration: 'none', color: '#1f2937', transition: 'all 0.15s',
            textAlign: 'center', background: 'white',
            boxShadow: '0 1px 3px rgba(16,24,40,.03)',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.borderColor = '#2c7873'
            el.style.boxShadow = '0 2px 10px rgba(44,120,115,.10)'
            el.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.borderColor = '#e6e8eb'
            el.style.boxShadow = '0 1px 3px rgba(16,24,40,.03)'
            el.style.transform = 'none'
          }}>
          <span style={{ fontSize: '1.6rem' }}>🎙</span>
          <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{c.name}</span>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{c.count} sentences</span>
          {c.avg != null && (
            <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, ...sStyle }}>
              Avg {c.avg.toFixed(1)}
            </span>
          )}
          {c.practiced > 0 && (
            <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{c.practiced}×</span>
          )}
        </Link>
        {/* Play last recording button — sits below card */}
        {c.practiced > 0 && (
          <button
            onClick={e => { e.stopPropagation(); setModal(c) }}
            title="Review last recording"
            style={{
              position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)',
              background: hasAudio ? '#1e7373' : '#9ca3af',
              border: 'none', borderRadius: 20, padding: '3px 12px',
              color: '#fff', fontSize: '0.68rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            }}
          >
            {hasAudio ? '▶ Last session' : '📋 Last session'}
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem', fontSize: '0.78rem', color: '#6b7280' }}>
          <Link href={`/practice/speaking/${mode}`} style={{ color: '#2c7873', textDecoration: 'none' }}>
            {mode === 'listen-and-repeat' ? 'Listen & Repeat' : 'Interview'}
          </Link>
          <span>/</span>
          <span style={{ fontWeight: 600, color: '#1f2937' }}>All Topics</span>
        </div>

        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <h1 style={{ fontSize: '1.4rem', color: '#1f2937', marginBottom: 6 }}>Choose a Topic</h1>
          <p style={{ color: '#6b7280', fontSize: '0.88rem' }}>Each topic has 7 sentences. Pick one to start practicing.</p>
        </div>

        {practiced.length > 0 && (
          <>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', padding: '12px 0 4px', borderBottom: '1px solid #f1f2f4', marginBottom: 24 }}>
              Continue Practicing
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 24, marginBottom: 36 }}>
              {practiced.map(c => <Card key={c.tags} c={c} />)}
            </div>
          </>
        )}

        {newCards.length > 0 && (
          <>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', padding: '12px 0 4px', borderBottom: '1px solid #f1f2f4', marginBottom: 24, marginTop: practiced.length > 0 ? 8 : 0 }}>
              New
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
              {newCards.map(c => <Card key={c.tags} c={c} />)}
            </div>
          </>
        )}
      </main>

      {modal && (
        <RecordingModal card={modal} onClose={() => setModal(null)} token={token} mode={mode} />
      )}
    </>
  )
}

export default function SpeakingTopicsPage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = use(params)
  return <RequireAuth><TopicsContent mode={mode} /></RequireAuth>
}
