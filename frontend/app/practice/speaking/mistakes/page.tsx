'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { AnnotatedSentence } from '@/components/CorrectionPopover'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

interface Mistake {
  id: number
  date: string
  category: string
  sub_type: string | null
  section: string | null
  task_type: string | null
  wrong: string
  correct: string
  recurrence_count: number
  reviewed: number
}

interface MistakesResp {
  rows: Mistake[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

interface FilterOptions {
  task_types: string[]
  categories: string[]
}

const PAGE_SIZES = [10, 25, 50, 100]

const TASK_TYPE_LABELS: Record<string, string> = {
  'Take an Interview': 'Interview',
  'Listen and Repeat': 'Listen & Repeat',
}
function label(tt: string) { return TASK_TYPE_LABELS[tt] ?? tt }

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function groupByDate(rows: Mistake[]): { date: string; items: Mistake[] }[] {
  const groups: { date: string; items: Mistake[] }[] = []
  for (const row of rows) {
    const day = (row.date || '').slice(0, 10)
    const last = groups[groups.length - 1]
    if (last && last.date === day) {
      last.items.push(row)
    } else {
      groups.push({ date: day, items: [row] })
    }
  }
  return groups
}

function SpeakingMistakesContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const pageParam     = parseInt(searchParams.get('page')      || '1',  10)
  const pageSizeParam = parseInt(searchParams.get('page_size') || '10', 10)
  const sortParam     = (searchParams.get('sort') || 'desc') as 'asc' | 'desc'
  const taskTypeParam = searchParams.get('task_type') || ''
  const categoryParam = searchParams.get('category')  || ''

  const [data, setData]               = useState<MistakesResp | null>(null)
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState('')
  const [filterOpts, setFilterOpts]   = useState<FilterOptions | null>(null)

  useEffect(() => {
    api.get<FilterOptions>('/api/grammar/filter-options', { section: 'Speaking' }).then(setFilterOpts).catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setErr('')
    api.get<MistakesResp>('/api/grammar/mistakes', {
      page: pageParam, page_size: pageSizeParam, sort: sortParam,
      task_type: taskTypeParam, category: categoryParam,
      section: 'Speaking',
    })
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [pageParam, pageSizeParam, sortParam, taskTypeParam, categoryParam])

  useEffect(() => { load() }, [load])

  function navigate(opts: {
    page?: number; sort?: 'asc' | 'desc'; pageSize?: number
    taskType?: string; category?: string
  }) {
    const p   = opts.page     ?? pageParam
    const s   = opts.sort     ?? sortParam
    const ps  = opts.pageSize ?? pageSizeParam
    const tt  = opts.taskType  !== undefined ? opts.taskType  : taskTypeParam
    const cat = opts.category  !== undefined ? opts.category  : categoryParam
    const params = new URLSearchParams({ page: String(p), sort: s, page_size: String(ps) })
    if (tt)  params.set('task_type', tt)
    if (cat) params.set('category', cat)
    router.push(`/practice/speaking/mistakes?${params.toString()}`)
  }

  const hasFilter = !!(taskTypeParam || categoryParam)

  if (err) return (
    <><Topbar /><main style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1rem' }}>
      <p style={{ color: '#dc2626' }}>{err}</p>
    </main></>
  )

  const groups = data ? groupByDate(data.rows) : []

  // Build practice link with current filters
  const practiceParams = new URLSearchParams()
  if (taskTypeParam) practiceParams.set('task_type', taskTypeParam)
  if (categoryParam) practiceParams.set('category', categoryParam)
  const practiceHref = `/practice/speaking/mistakes/go${practiceParams.toString() ? '?' + practiceParams.toString() : ''}`

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1rem' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#9ca3af', marginBottom: '1.5rem' }}>
          <Link href="/practice" style={{ color: '#6b7280', textDecoration: 'none' }}>Practice</Link>
          <span>/</span>
          <span style={{ color: '#1f2937', fontWeight: 600 }}>Speaking Mistakes</span>
        </div>

        {/* Header + Practice button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1f2937' }}>Speaking Mistakes</h1>
            {data && (
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#9ca3af' }}>
                {data.total} total · page {data.page} of {data.total_pages}
                {hasFilter && <span style={{ color: '#2a7a7a', marginLeft: 6 }}>· filtered</span>}
              </p>
            )}
          </div>
          {data && data.total > 0 && (
            <Link href={practiceHref}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                background: 'var(--teal-700)', color: '#fff', textDecoration: 'none',
              }}>
              🎤 Practice
            </Link>
          )}
        </div>

        {/* ── Controls: Sort + Show ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', marginBottom: '1.25rem' }}>

          {/* Sort */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>Sort:</span>
            {(['desc', 'asc'] as const).map(s => (
              <button key={s} onClick={() => navigate({ sort: s, page: 1 })}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                  border: '1px solid', cursor: 'pointer',
                  borderColor: sortParam === s ? 'var(--teal-700)' : '#e5e7eb',
                  background:  sortParam === s ? 'var(--teal-700)' : '#fff',
                  color:       sortParam === s ? '#fff' : '#6b7280',
                }}>
                {s === 'desc' ? 'Latest' : 'Oldest'}
              </button>
            ))}
          </div>

          {/* Show */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>Show:</span>
            {PAGE_SIZES.map(ps => (
              <button key={ps} onClick={() => navigate({ pageSize: ps, page: 1 })}
                style={{
                  padding: '5px 10px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                  border: '1px solid', cursor: 'pointer',
                  borderColor: pageSizeParam === ps ? 'var(--teal-700)' : '#e5e7eb',
                  background:  pageSizeParam === ps ? 'var(--teal-50)' : '#fff',
                  color:       pageSizeParam === ps ? 'var(--teal-700)' : '#6b7280',
                }}>
                {ps}
              </button>
            ))}
          </div>
        </div>

        {/* ── Filters ── */}
        <div style={{ marginBottom: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>

          {/* Test type */}
          {filterOpts && filterOpts.task_types.length > 0 && (
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Test type
              </p>
              <select value={taskTypeParam} onChange={e => navigate({ taskType: e.target.value, page: 1 })}
                style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 500, outline: 'none', cursor: 'pointer',
                  border: `1px solid ${taskTypeParam ? 'var(--teal-700)' : '#e5e7eb'}`,
                  background: taskTypeParam ? 'var(--teal-50)' : '#fff',
                  color: taskTypeParam ? 'var(--teal-700)' : '#374151',
                  minWidth: 160,
                }}>
                <option value="">All test types</option>
                {filterOpts.task_types.map(tt => (
                  <option key={tt} value={tt}>{label(tt)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Grammar category */}
          {filterOpts && filterOpts.categories.length > 0 && (
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Grammar category
              </p>
              <select value={categoryParam} onChange={e => navigate({ category: e.target.value, page: 1 })}
                style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 500, outline: 'none', cursor: 'pointer',
                  border: `1px solid ${categoryParam ? 'var(--teal-700)' : '#e5e7eb'}`,
                  background: categoryParam ? 'var(--teal-50)' : '#fff',
                  color: categoryParam ? 'var(--teal-700)' : '#374151',
                  minWidth: 180,
                }}>
                <option value="">All categories</option>
                {filterOpts.categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {/* Clear */}
          {hasFilter && (
            <button onClick={() => navigate({ taskType: '', category: '', page: 1 })}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
                border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', cursor: 'pointer',
                alignSelf: 'flex-end',
              }}>
              ✕ Clear filters
            </button>
          )}
        </div>

        {/* ── List ── */}
        {loading ? (
          <div style={{ color: '#9ca3af', fontSize: '0.85rem', padding: '2rem 0' }}>Loading…</div>
        ) : groups.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: '0.85rem', padding: '2rem 0', textAlign: 'center' }}>
            No speaking mistakes found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {groups.map(group => (
              <div key={group.date}>

                {/* Date header */}
                <div style={{
                  fontSize: '0.72rem', fontWeight: 700, color: '#9ca3af',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '18px 0 8px',
                  borderBottom: '1px solid #f3f4f6',
                  marginBottom: 8,
                }}>
                  {formatDate(group.date)}
                  <span style={{ marginLeft: 8, fontWeight: 400, color: '#d1d5db' }}>
                    {group.items.length} mistake{group.items.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Cards in this group */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
                  {group.items.map(m => (
                    <Link key={m.id} href={`/practice/speaking/mistakes/${m.id}`} style={{ textDecoration: 'none' }}>
                      <div
                        className="table-card"
                        style={{ padding: '12px 16px', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s' }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--teal-700)'; el.style.background = 'var(--teal-50)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = ''; el.style.background = '' }}
                      >
                        {/* Meta row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--teal-700)' }}>
                            {m.category}
                          </span>
                          {m.sub_type && (
                            <span style={{ fontSize: '0.7rem', color: '#6b7280', background: '#f3f4f6', borderRadius: 4, padding: '1px 6px' }}>
                              {m.sub_type}
                            </span>
                          )}
                          {m.task_type && (
                            <span style={{ fontSize: '0.7rem', color: '#9ca3af', background: '#f9fafb', borderRadius: 4, padding: '1px 6px', border: '1px solid #e5e7eb' }}>
                              {label(m.task_type)}
                            </span>
                          )}
                          {m.recurrence_count > 1 && (
                            <span style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 700 }}>
                              {m.recurrence_count}×
                            </span>
                          )}
                        </div>

                        {/* Inline diff sentence */}
                        <div style={{ fontSize: '0.85rem', color: '#1f2937', lineHeight: 1.5 }}>
                          <AnnotatedSentence wrong={m.wrong} correct={m.correct} />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {data && data.total_pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: '1.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => navigate({ page: pageParam - 1 })} disabled={pageParam <= 1}
              style={{ padding: '5px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', cursor: pageParam <= 1 ? 'default' : 'pointer', opacity: pageParam <= 1 ? 0.4 : 1 }}>
              ← Prev
            </button>

            {Array.from({ length: data.total_pages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === data.total_pages || Math.abs(p - pageParam) <= 2)
              .reduce<(number | '…')[]>((acc, p, i, arr) => {
                if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === '…' ? (
                  <span key={`e-${i}`} style={{ color: '#9ca3af', fontSize: '0.8rem', padding: '0 4px' }}>…</span>
                ) : (
                  <button key={p} onClick={() => navigate({ page: p as number })}
                    style={{ width: 32, height: 32, borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, border: '1px solid', borderColor: pageParam === p ? 'var(--teal-700)' : '#e5e7eb', background: pageParam === p ? 'var(--teal-700)' : '#fff', color: pageParam === p ? '#fff' : '#374151', cursor: 'pointer' }}>
                    {p}
                  </button>
                )
              )
            }

            <button onClick={() => navigate({ page: pageParam + 1 })} disabled={pageParam >= data.total_pages}
              style={{ padding: '5px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', cursor: pageParam >= data.total_pages ? 'default' : 'pointer', opacity: pageParam >= data.total_pages ? 0.4 : 1 }}>
              Next →
            </button>
          </div>
        )}

      </main>
    </>
  )
}

export default function SpeakingMistakesPage() {
  return <RequireAuth><SpeakingMistakesContent /></RequireAuth>
}
