'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Task {
  task_id: number
  task_type: string
  question: string
  tags: string | null
  answer: string | null
}

interface TasksResp {
  rows: Task[]
  total: number
  total_pages: number
  page: number
}

const TASK_TYPES = [
  'Build a Sentence',
  'Listen and Repeat',
  'Take an Interview',
  'Write an Email',
  'Write for an Academic Discussion',
]

const TYPE_COLOR: Record<string, { bg: string; color: string }> = {
  'Build a Sentence':                  { bg: '#e0f2f1', color: '#2a7a7a' },
  'Listen and Repeat':                 { bg: '#fff3e0', color: '#e65100' },
  'Take an Interview':                 { bg: '#fce4ec', color: '#c62828' },
  'Write an Email':                    { bg: '#e8f0fe', color: '#1a56c4' },
  'Write for an Academic Discussion':  { bg: '#f3e5f5', color: '#7b1fa2' },
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Badge({ taskType }: { taskType: string }) {
  const c = TYPE_COLOR[taskType] ?? { bg: '#f1f2f4', color: '#6b7280' }
  return (
    <span style={{
      fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px',
      borderRadius: 10, background: c.bg, color: c.color, whiteSpace: 'nowrap',
    }}>
      {taskType}
    </span>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 1000, padding: '40px 16px', overflowY: 'auto',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'white', borderRadius: 14, width: '100%', maxWidth: 600,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #f1f2f4' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1f2937' }}>{title}</span>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '1.25rem', lineHeight: 1, padding: 4 }}>
            ✕
          </button>
        </div>
        <div style={{ padding: '20px 24px' }}>{children}</div>
      </div>
    </div>
  )
}

function AnswerEditForm({
  task,
  onSave,
  onCancel,
  saving,
}: {
  task: Task
  onSave: (answer: string) => void
  onCancel: () => void
  saving: boolean
}) {
  const [answer, setAnswer] = useState(task.answer ?? '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Question preview */}
      <div style={{ background: '#f9fafb', border: '1px solid #e6e8eb', borderRadius: 8, padding: '12px 14px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <Badge taskType={task.task_type} />
          <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>#{task.task_id}</span>
        </div>
        <p style={{ fontSize: '0.82rem', color: '#374151', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {task.question}
        </p>
      </div>

      {/* Answer textarea */}
      <div>
        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>
          Model Answer
        </label>
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder="Type the expected answer or model response…"
          style={{
            width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px',
            fontSize: '0.875rem', color: '#1f2937', outline: 'none', boxSizing: 'border-box',
            background: 'white', resize: 'vertical', minHeight: 120, fontFamily: 'inherit', lineHeight: 1.6,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={saving}
          style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={() => onSave(answer)} disabled={saving}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: saving ? '#9ca3af' : '#1a56c4', color: 'white', fontSize: '0.875rem', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving…' : 'Save Answer'}
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AnswersContent() {
  const [rows, setRows]             = useState<Task[]>([])
  const [total, setTotal]           = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage]             = useState(1)
  const [loading, setLoading]       = useState(true)
  const [filterType, setFilterType] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [search, setSearch]         = useState('')
  const [searchInput, setSearchInput] = useState('')

  const [editTask, setEditTask]     = useState<Task | null>(null)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  // Stats
  const [stats, setStats] = useState<{ task_type: string; total: number; missing: number }[]>([])

  const loadStats = useCallback(() => {
    api.get<{ rows: typeof stats }>('/api/admin/answer-stats').then(d => {
      setStats(d.rows)
    }).catch(() => {/* stats are best-effort */})
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    api.get<TasksResp>('/api/admin/tasks', {
      task_type: filterType || undefined,
      search: search || undefined,
      missing_only: missingOnly ? 1 : undefined,
      page,
      page_size: 30,
    }).then(d => {
      setRows(d.rows)
      setTotal(d.total)
      setTotalPages(d.total_pages)
    }).catch(() => setError('Failed to load tasks'))
      .finally(() => setLoading(false))
  }, [filterType, search, missingOnly, page])

  useEffect(() => { load(); loadStats() }, [load, loadStats])
  useEffect(() => { setPage(1) }, [filterType, search, missingOnly])

  async function handleSave(answer: string) {
    if (!editTask) return
    setSaving(true); setError('')
    try {
      await api.put(`/api/admin/tasks/${editTask.task_id}`, {
        answer: answer.trim() || null,
      })
      setEditTask(null)
      load()
      loadStats()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save answer')
    } finally { setSaving(false) }
  }

  const totalMissing = stats.reduce((s, r) => s + r.missing, 0)

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1rem' }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 16 }}>
          <Link href="/admin" style={{ color: '#6b7280', textDecoration: 'none' }}>← Admin</Link>
        </div>

        {/* Header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#1f2937', margin: '0 0 4px' }}>
            ✅ Answer Keys
          </h1>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
            {totalMissing > 0
              ? `${totalMissing} task${totalMissing !== 1 ? 's' : ''} still missing an answer`
              : 'All tasks have model answers'}
          </p>
        </div>

        {/* Stats row */}
        {stats.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {stats.map(s => (
              <div key={s.task_type} style={{
                background: s.missing > 0 ? '#fef3c7' : '#f0fdf4',
                border: `1px solid ${s.missing > 0 ? '#fde68a' : '#bbf7d0'}`,
                borderRadius: 8, padding: '6px 12px',
                fontSize: '0.75rem', color: s.missing > 0 ? '#92400e' : '#166534',
              }}>
                <span style={{ fontWeight: 700 }}>{s.task_type.split(' ').slice(-1)[0]}</span>
                {' '}
                {s.total - s.missing}/{s.total}
                {s.missing > 0 && <span style={{ marginLeft: 4, fontWeight: 700 }}>({s.missing} missing)</span>}
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: '#fdeaea', color: '#dc2626', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.875rem' }}>
            {error}
            <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: '0.875rem', color: '#1f2937', background: 'white', minWidth: 220 }}>
            <option value="">All types</option>
            {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Missing only toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.875rem', color: '#374151', fontWeight: missingOnly ? 600 : 400,
            padding: '8px 14px', border: `1px solid ${missingOnly ? '#f59e0b' : '#d1d5db'}`,
            borderRadius: 8, background: missingOnly ? '#fef3c7' : 'white', userSelect: 'none' }}>
            <input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: '#f59e0b' }} />
            Missing only
          </label>

          <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 180 }}>
            <input
              type="text"
              placeholder="Search…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1) } }}
              style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: '0.875rem', color: '#1f2937', outline: 'none' }}
            />
            <button onClick={() => { setSearch(searchInput); setPage(1) }}
              style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
              Search
            </button>
            {(search || filterType || missingOnly) && (
              <button onClick={() => { setSearchInput(''); setSearch(''); setFilterType(''); setMissingOnly(false); setPage(1) }}
                style={{ padding: '8px 12px', background: 'none', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', color: '#6b7280', cursor: 'pointer' }}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Count */}
        {!loading && (
          <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 12 }}>
            {total} task{total !== 1 ? 's' : ''}
          </p>
        )}

        {/* List */}
        {loading ? (
          <p style={{ color: '#6b7280', padding: '2rem 0' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: '#9ca3af' }}>
            <p style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</p>
            <p>{missingOnly ? 'No tasks missing answers!' : 'No tasks found.'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(task => {
              const hasAnswer = !!task.answer
              return (
                <div key={task.task_id}
                  onClick={() => setEditTask(task)}
                  style={{
                    background: 'white', border: `1px solid ${hasAnswer ? '#e6e8eb' : '#fde68a'}`,
                    borderRadius: 12, padding: '12px 16px', boxShadow: '0 1px 3px rgba(16,24,40,.03)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = hasAnswer ? '#2a7a7a' : '#f59e0b' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = hasAnswer ? '#e6e8eb' : '#fde68a' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    {/* Status dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 6,
                      background: hasAnswer ? '#22c55e' : '#f59e0b',
                    }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
                        <Badge taskType={task.task_type} />
                        {task.tags && (
                          <span style={{ fontSize: '0.65rem', color: '#6b7280', background: '#f1f2f4', padding: '2px 7px', borderRadius: 10 }}>
                            {task.tags}
                          </span>
                        )}
                        <span style={{ fontSize: '0.65rem', color: '#9ca3af', marginLeft: 'auto' }}>#{task.task_id}</span>
                      </div>

                      <p style={{ fontSize: '0.82rem', color: '#374151', margin: '0 0 6px', lineHeight: 1.5, wordBreak: 'break-word' }}>
                        {task.question.length > 160 ? task.question.slice(0, 160) + '…' : task.question}
                      </p>

                      {hasAnswer ? (
                        <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: 0, lineHeight: 1.4 }}>
                          <strong style={{ color: '#22c55e' }}>✓</strong>{' '}
                          {task.answer!.length > 100 ? task.answer!.slice(0, 100) + '…' : task.answer}
                        </p>
                      ) : (
                        <p style={{ fontSize: '0.75rem', color: '#f59e0b', margin: 0, fontWeight: 600 }}>
                          ⚠ No answer yet
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: page === 1 ? '#f3f4f6' : 'white', color: page === 1 ? '#9ca3af' : '#374151', fontSize: '0.875rem', cursor: page === 1 ? 'not-allowed' : 'pointer' }}>
              ← Prev
            </button>
            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              Page {page} of {totalPages}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: page === totalPages ? '#f3f4f6' : 'white', color: page === totalPages ? '#9ca3af' : '#374151', fontSize: '0.875rem', cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>
              Next →
            </button>
          </div>
        )}
      </main>

      {/* Edit answer modal */}
      {editTask && (
        <Modal
          title={editTask.answer ? `Edit Answer — #${editTask.task_id}` : `Add Answer — #${editTask.task_id}`}
          onClose={() => setEditTask(null)}
        >
          <AnswerEditForm
            task={editTask}
            onSave={handleSave}
            onCancel={() => setEditTask(null)}
            saving={saving}
          />
        </Modal>
      )}
    </>
  )
}

export default function AnswersPage() {
  return <RequireAuth><AnswersContent /></RequireAuth>
}
