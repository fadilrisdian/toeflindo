'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

interface Task { task_id: number; question: string; task_type: string }
interface TasksResp { rows: Task[]; total: number; total_pages: number; page: number }
interface SessionRow { score: number | null; tags?: string }
interface SessionsResp { rows: SessionRow[]; total: number }

const TYPE_LABEL: Record<string, string> = {
  email:      'Write an Email',
  discussion: 'Write for an Academic Discussion',
}

interface TaskCard {
  task: Task
  bestScore: number | null
  attempts: number
}

function scoreStyle(score: number): React.CSSProperties {
  if (score >= 4.5) return { background: '#e7f7ec', color: '#16a34a' }
  if (score >= 3.0) return { background: '#fef3e2', color: '#b45309' }
  return { background: '#fdeaea', color: '#dc2626' }
}

function BrowseContent({ slug }: { slug: string }) {
  const taskType = TYPE_LABEL[slug] ?? ''
  const [practiced, setPracticed] = useState<TaskCard[]>([])
  const [newTasks,  setNewTasks]  = useState<TaskCard[]>([])
  const [page,      setPage]      = useState(1)
  const [totalPages, setTotal]    = useState(1)
  const [loading,   setLoad]      = useState(true)

  useEffect(() => {
    Promise.all([
      api.get<TasksResp>('/api/task/bank', { task_type: taskType, page_size: 100 }),
      api.get<SessionsResp>('/api/writing/sessions', { page_size: 500 }).catch(() => ({ rows: [], total: 0 })),
    ]).then(([tasksResp, sessResp]) => {
      const tasks = tasksResp.rows
      const sessions = (sessResp as SessionsResp).rows ?? []

      // Build score history per task_id from tags
      const scoreMap: Record<number, number[]> = {}
      sessions.forEach(s => {
        if (!s.tags) return
        const m = s.tags.match(/task_id:(\d+)/)
        if (m && s.score != null) {
          const tid = +m[1]
          if (!scoreMap[tid]) scoreMap[tid] = []
          scoreMap[tid].push(s.score)
        }
      })

      const cards: TaskCard[] = tasks.map(t => {
        const scores = scoreMap[t.task_id] || []
        const best = scores.length ? Math.max(...scores) : null
        return { task: t, bestScore: best, attempts: scores.length }
      })

      const prac = cards.filter(c => c.attempts > 0).sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0))
      const newC  = cards.filter(c => c.attempts === 0)

      setPracticed(prac)
      setNewTasks(newC)
      setTotal(tasksResp.total_pages)
    }).finally(() => setLoad(false))
  }, [taskType])

  if (loading) return <><Topbar /><p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p></>

  function TaskCard({ c }: { c: TaskCard }) {
    const snippet = c.task.question.split('\n')[0].slice(0, 100)
    const truncated = c.task.question.split('\n')[0].length > 100
    return (
      <Link href={`/practice/writing/${slug}/go?task_id=${c.task.task_id}`}
        style={{
          display: 'block', background: 'white', border: '1px solid #e6e8eb',
          borderRadius: 12, padding: '14px 16px', textDecoration: 'none',
          color: '#1f2937', transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: '0 1px 3px rgba(16,24,40,.03)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2c7873'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(44,120,115,.10)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e6e8eb'; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(16,24,40,.03)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <p style={{ fontSize: '0.875rem', color: '#1f2937', lineHeight: 1.5, flex: 1 }}>
            {snippet}{truncated ? '…' : ''}
          </p>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {c.bestScore != null && (
              <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 10, ...scoreStyle(c.bestScore) }}>
                Best {c.bestScore.toFixed(1)}
              </span>
            )}
            {c.attempts > 0 && (
              <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{c.attempts}×</span>
            )}
          </div>
        </div>
        <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>Task #{c.task.task_id}</p>
      </Link>
    )
  }

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem', fontSize: '0.78rem', color: '#6b7280' }}>
          <Link href={`/practice/writing/${slug}`} style={{ color: '#2c7873', textDecoration: 'none' }}>
            {TYPE_LABEL[slug]}
          </Link>
          <span>/</span>
          <span style={{ fontWeight: 600, color: '#1f2937' }}>Browse Tasks</span>
        </div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f2937', marginBottom: '1.5rem' }}>Browse Tasks</h1>

        {/* Practiced */}
        {practiced.length > 0 && (
          <>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', padding: '0 0 8px', marginBottom: 12, borderBottom: '1px solid #f1f2f4' }}>
              Continue Practicing
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {practiced.map(c => <TaskCard key={c.task.task_id} c={c} />)}
            </div>
          </>
        )}

        {/* New */}
        {newTasks.length > 0 && (
          <>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', padding: '0 0 8px', marginBottom: 12, borderBottom: '1px solid #f1f2f4', marginTop: practiced.length > 0 ? 8 : 0 }}>
              New
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {newTasks.map(c => <TaskCard key={c.task.task_id} c={c} />)}
            </div>
          </>
        )}
      </main>
    </>
  )
}

export default function WritingBrowsePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params)
  return <RequireAuth><BrowseContent slug={type} /></RequireAuth>
}
