'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)
Chart.defaults.color = '#6b7280'

// ── Types ───────────────────────────────────────────────────────────────────
interface GrammarData {
  totals: { total_mistakes: number; total_recurrences: number; pending_review: number; recurring: number }
  categories: { category: string; mistake_count: number; total_recurrences: number; unreviewed: number; last_seen: string }[]
  grammar_perf: { grammar_type: string; total_attempts: number; accuracy: number }[]
  unreviewed_by_cat: { category: string; cnt: number }[]
  top_mistakes: { id: number; category: string; sub_type: string; wrong: string; correct: string; explanation: string; recurrence_count: number; reviewed: number; date: string; section: string; remediation_status: string | null }[]
  recent_mistakes: { id: number; date: string; grammar_type: string; sub_type: string; wrong: string; correct: string; explanation: string; section: string; recurrence_count: number; reviewed: number; remediation_status: string | null }[]
  murphy_map: { category: string; sub_type: string | null; units: number[] }[]
}

const DOUGHNUT_COLORS = [
  '#ef4444','#f97316','#eab308','#84cc16','#22c55e',
  '#14b8a6','#6366f1','#a855f7','#ec4899','#64748b',
  '#06b6d4','#f59e0b','#10b981','#8b5cf6','#f43f5e',
]

const PAGE_SIZE = 15

function badgeClass(v: number, hi: number, mid: number) {
  return v >= hi ? 'badge-good' : v >= mid ? 'badge-mid' : 'badge-bad'
}

// ── Category Weakness Bar Chart ─────────────────────────────────────────────
function CategoryChart({ data }: { data: GrammarData['categories'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !data.length) return
    const vals = data.map(c => c.total_recurrences)
    const colors = vals.map(v => v >= 10 ? 'rgba(220,38,38,0.75)' : v >= 5 ? 'rgba(180,83,9,0.75)' : 'rgba(44,120,115,0.65)')
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: data.map(c => c.category),
        datasets: [{ label: 'Total Recurrences', data: vals, backgroundColor: colors, borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: '#9ca3af' }, grid: { color: '#f1f2f4' } },
          y: { ticks: { color: '#374151', font: { size: 11 } }, grid: { display: false } },
        },
      },
    })
    return () => chart.destroy()
  }, [data])
  return <div style={{ position: 'relative', height: Math.max(200, data.length * 28 + 40) }}><canvas ref={ref} /></div>
}

// ── Unreviewed Doughnut ─────────────────────────────────────────────────────
function UnreviewedChart({ data }: { data: GrammarData['unreviewed_by_cat'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !data.length) return
    const chart = new Chart(ref.current, {
      type: 'doughnut',
      data: {
        labels: data.map(c => c.category),
        datasets: [{
          data: data.map(c => c.cnt),
          backgroundColor: DOUGHNUT_COLORS.slice(0, data.length),
          borderWidth: 1, borderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#6b7280', font: { size: 11 }, boxWidth: 12 } },
        },
      },
    })
    return () => chart.destroy()
  }, [data])
  return <div style={{ position: 'relative', height: 280 }}><canvas ref={ref} /></div>
}

// ── Grammar Accuracy Bar Chart ──────────────────────────────────────────────
function AccuracyChart({ data }: { data: GrammarData['grammar_perf'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !data.length) return
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: data.map(g => `${g.grammar_type} (n=${g.total_attempts})`),
        datasets: [{
          label: 'Accuracy %',
          data: data.map(g => g.accuracy),
          backgroundColor: data.map(g => g.accuracy >= 80 ? '#e7f7ec' : g.accuracy >= 50 ? '#fef3e2' : '#fdeaea'),
          borderColor:      data.map(g => g.accuracy >= 80 ? '#16a34a' : g.accuracy >= 50 ? '#b45309' : '#dc2626'),
          borderWidth: 1.5, borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { min: 0, max: 100, ticks: { color: '#9ca3af', callback: v => v + '%' }, grid: { color: '#f1f2f4' } },
          y: { ticks: { color: '#374151', font: { size: 11 } }, grid: { display: false } },
        },
      },
    })
    return () => chart.destroy()
  }, [data])
  return <div style={{ position: 'relative', height: Math.max(200, data.length * 30 + 40) }}><canvas ref={ref} /></div>
}

// ── Progress bar ────────────────────────────────────────────────────────────
function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="progress-bar-bg">
      <div className="progress-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

// ── Remediation Panel ────────────────────────────────────────────────────────
interface TrendRow {
  grammar_type: string
  remediation_status: string
  review_stage: number
  trend: 'improving' | 'regressing' | 'stable'
  recent_14d: number
  prev_14d: number
}

const TREND_ICON:  Record<string, string> = { improving: '↓', regressing: '↑', stable: '→' }
const TREND_COLOR: Record<string, string> = { improving: '#15803d', regressing: '#dc2626', stable: '#6b7280' }
const TREND_LABEL: Record<string, string> = { improving: 'errors declining', regressing: 're-appearing', stable: 'stable' }
const STAGE_NEXT:  Record<number, string> = { 0: '1d', 1: '3d', 2: '7d', 3: '14d', 4: '30d' }
const STATUS_COLOR: Record<string, string> = { new: '#9ca3af', engaged: '#2a7a7a', mastered: '#15803d' }

function RemediationPanel() {
  const [trends, setTrends] = useState<TrendRow[]>([])

  useEffect(() => {
    api.get<TrendRow[]>('/api/grammar/remediation-trends').then(setTrends).catch(() => {})
  }, [])

  if (trends.length === 0) return null

  const regressing = trends.filter(t => t.trend === 'regressing')
  const improving  = trends.filter(t => t.trend === 'improving')
  const stable     = trends.filter(t => t.trend === 'stable')

  return (
    <div className="table-card section-gap" style={{ padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Pattern Progress</div>
        <div style={{ display: 'flex', gap: 12, fontSize: '0.72rem' }}>
          {regressing.length > 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>↑ {regressing.length} re-appearing</span>}
          {improving.length > 0  && <span style={{ color: '#15803d', fontWeight: 600 }}>↓ {improving.length} improving</span>}
          {stable.length > 0     && <span style={{ color: '#6b7280' }}>→ {stable.length} stable</span>}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[...regressing, ...improving, ...stable].map(r => (
          <div key={r.grammar_type} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#f9fafb', border: '1px solid #f3f4f6',
            borderRadius: 8, padding: '8px 12px',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#1f2937' }}>{r.grammar_type}</span>
              <span style={{ marginLeft: 8, fontSize: '0.68rem', color: STATUS_COLOR[r.remediation_status], fontWeight: 600 }}>
                {r.remediation_status} · stage {r.review_stage}
              </span>
              {r.review_stage < 4 && (
                <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#9ca3af' }}>
                  next in {STAGE_NEXT[r.review_stage] || '30d'}
                </span>
              )}
            </div>
            <span style={{ fontWeight: 700, color: TREND_COLOR[r.trend], fontSize: '0.85rem', flexShrink: 0 }}>
              {TREND_ICON[r.trend]}
            </span>
            <span style={{ fontSize: '0.68rem', color: TREND_COLOR[r.trend], flexShrink: 0, minWidth: 80, textAlign: 'right' }}>
              {TREND_LABEL[r.trend]}
            </span>
            <Link
              href={`/practice/grammar/all-mistakes?category=${encodeURIComponent(r.grammar_type)}`}
              style={{
                fontSize: '0.68rem', color: '#2a7a7a', fontWeight: 600,
                background: '#eaf5f3', border: '1px solid #c0dedd',
                borderRadius: 6, padding: '3px 8px', textDecoration: 'none', flexShrink: 0,
              }}
            >
              Strengthen →
            </Link>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 8 }}>
        Trend = last 14 days vs prior 14 days
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────
function GrammarDashContent() {
  const [data, setData] = useState<GrammarData | null>(null)
  const [err, setErr] = useState('')
  const [filterSection, setFilterSection] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [page, setPage] = useState(1)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const router = useRouter()

  useEffect(() => {
    api.get<GrammarData>('/api/dashboard/grammar').then(setData).catch(e => setErr(e.message))
  }, [])

  if (err) return <p style={{ color: '#dc2626', padding: '1.5rem' }}>{err}</p>
  if (!data) return <><Topbar /><p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p></>

  const { totals, categories, grammar_perf, unreviewed_by_cat, top_mistakes, recent_mistakes, murphy_map } = data

  // Build two separate lookups from murphy_map:
  // fallback (sub_type === null) → shown in the category row by default
  // specific (sub_type !== null) → shown in expanded sub-rows
  const murphyFallback: Record<string, number[]> = {}
  const murphySubTypes: Record<string, { sub_type: string; units: number[] }[]> = {}
  murphy_map.forEach(m => {
    if (!m.sub_type) {
      murphyFallback[m.category] = Array.isArray(m.units) ? m.units : []
    } else {
      if (!murphySubTypes[m.category]) murphySubTypes[m.category] = []
      murphySubTypes[m.category].push({ sub_type: m.sub_type, units: Array.isArray(m.units) ? m.units : [] })
    }
  })

  function toggleCat(cat: string) {
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  // Filtered recent mistakes
  const filtered = recent_mistakes.filter(m =>
    (!filterSection || (m.section || '').toLowerCase() === filterSection.toLowerCase()) &&
    (!filterCategory || m.grammar_type === filterCategory)
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Unique categories for filter
  const allCategories = [...new Set(recent_mistakes.map(m => m.grammar_type))].sort()

  return (
    <>
      <Topbar />
      <div className="db-container">

        {/* ── Stat cards ── */}
        <div className="stats-grid-w section-gap">
          {[
            { label: 'Total Mistakes', value: totals.total_mistakes, sub: 'unique errors logged', color: '#1f2937' },
            { label: 'Total Recurrences', value: totals.total_recurrences, sub: 'times same error repeated', color: '#1f2937' },
            { label: 'Pending Review', value: totals.pending_review, sub: 'unreviewed mistakes', color: '#b45309' },
            { label: 'Recurring', value: totals.recurring, sub: 'seen 2+ times', color: '#dc2626' },
            { label: 'Categories', value: categories.length, sub: 'grammar areas tracked', color: '#1f2937' },
          ].map(c => (
            <div key={c.label} className="stat-card-w">
              <div className="stat-label">{c.label}</div>
              <div className="stat-value" style={{ color: c.color }}>{c.value ?? '—'}</div>
              <div className="stat-sub">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Charts row ── */}
        <div className="charts-grid section-gap">
          <div className="chart-card">
            <h3>Weakness by Category (Total Recurrences)</h3>
            {categories.length > 0
              ? <CategoryChart data={categories} />
              : <p className="empty-note">No mistakes logged yet.</p>
            }
          </div>
          <div className="chart-card">
            <h3>Unreviewed Mistakes by Category</h3>
            {unreviewed_by_cat.length > 0
              ? <UnreviewedChart data={unreviewed_by_cat} />
              : <p className="empty-note">All mistakes reviewed!</p>
            }
          </div>
        </div>

        {/* ── Remediation progress ── */}
        <RemediationPanel />

        {/* ── Grammar Accuracy chart ── */}
        {grammar_perf.length > 0 && (
          <div className="chart-card section-gap">
            <h3>Grammar Accuracy by Topic</h3>
            <div className="legend-row" style={{ marginBottom: '0.8rem' }}>
              <span><span className="dot green" />≥80%</span>
              <span><span className="dot amber" />50–79%</span>
              <span><span className="dot red" />&lt;50%</span>
            </div>
            <AccuracyChart data={grammar_perf} />
          </div>
        )}

        {/* ── Category breakdown table ── */}
        <div className="section-title">Category Breakdown + Murphy Units</div>
        <div className="table-card section-gap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Mistakes</th>
                <th className="num">Recurrences</th>
                <th className="num">Unreviewed</th>
                <th>Priority</th>
                <th>Murphy Units</th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {categories.map(c => {
                const rec = c.total_recurrences
                const priority = rec >= 10 ? 'High' : rec >= 5 ? 'Medium' : 'Low'
                const pClass = rec >= 10 ? 'badge-bad' : rec >= 5 ? 'badge-mid' : 'badge-good'
                const fallbackUnits = murphyFallback[c.category] || []
                const subRows = murphySubTypes[c.category] || []
                const isExpanded = expandedCats.has(c.category)
                return (
                  <Fragment key={c.category}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{c.category}</td>
                      <td className="num">{c.mistake_count}</td>
                      <td className="num">{c.total_recurrences}</td>
                      <td className="num">{c.unreviewed}</td>
                      <td><span className={`badge ${pClass}`}>{priority}</span></td>
                      <td>
                        {fallbackUnits.length > 0
                          ? fallbackUnits.map(u => (
                              <Link key={u} href={`/learn/${u}`}
                                style={{ textDecoration: 'none' }}
                                onClick={e => e.stopPropagation()}>
                                <span className="murphy-unit-pill" style={{ cursor: 'pointer' }}>U{u}</span>
                              </Link>
                            ))
                          : <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>—</span>
                        }
                      </td>
                      <td>
                        {subRows.length > 0 && (
                          <button
                            onClick={() => toggleCat(c.category)}
                            title={isExpanded ? 'Hide sub-types' : `Show ${subRows.length} sub-types`}
                            style={{
                              background: isExpanded ? 'var(--teal-50)' : '#f9fafb',
                              border: `1px solid ${isExpanded ? 'var(--teal-700)' : '#e5e7eb'}`,
                              borderRadius: 5, padding: '2px 7px',
                              fontSize: '0.7rem', fontWeight: 700,
                              color: isExpanded ? 'var(--teal-700)' : '#6b7280',
                              cursor: 'pointer', whiteSpace: 'nowrap',
                            }}>
                            {isExpanded ? '▾' : '▸'} {subRows.length}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && subRows.map(sr => (
                      <tr key={`${c.category}__${sr.sub_type}`} style={{ background: '#f9fafb' }}>
                        <td colSpan={5} style={{ paddingLeft: '2rem', borderTop: 'none' }}>
                          <span style={{
                            background: 'var(--teal-50)', color: 'var(--teal-700)',
                            borderRadius: 5, padding: '1px 8px',
                            fontSize: '0.73rem', fontWeight: 600,
                          }}>
                            {sr.sub_type}
                          </span>
                        </td>
                        <td colSpan={2} style={{ borderTop: 'none' }}>
                          {sr.units.map(u => (
                            <Link key={u} href={`/learn/${u}`}
                              style={{ textDecoration: 'none' }}
                              onClick={e => e.stopPropagation()}>
                              <span className="murphy-unit-pill" style={{ cursor: 'pointer', opacity: 0.85 }}>U{u}</span>
                            </Link>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── All mistakes (filterable) ── */}
        <div className="section-title">All Mistakes</div>
        <div className="table-card section-gap">
          <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{filtered.length} mistakes</span>
            <select className="filter-select" value={filterSection}
              onChange={e => { setFilterSection(e.target.value); setPage(1) }}>
              <option value="">All Sections</option>
              <option value="speaking">Speaking</option>
              <option value="writing">Writing</option>
              <option value="grammar">Grammar</option>
            </select>
            <select className="filter-select" value={filterCategory}
              onChange={e => { setFilterCategory(e.target.value); setPage(1) }}>
              <option value="">All Categories</option>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Sub-type</th>
                <th>Wrong</th>
                <th>Correct</th>
                <th>Section</th>
                <th className="num">Seen</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((m) => {
                const strengthened = m.remediation_status === 'engaged' || m.remediation_status === 'mastered'
                return (
                  <tr key={m.id} className="clickable-row"
                    title={!strengthened ? '🔒 Complete "Strengthen This Pattern" to reveal' : undefined}
                    onClick={() => router.push(`/dashboard/grammar/mistakes/${m.id}`)}>
                    <td style={{ color: '#9ca3af' }}>{(m.date || '').slice(0, 10)}</td>
                    <td style={{ color: '#6b7280' }}>{m.grammar_type}</td>
                    <td style={{ color: '#6b7280' }}>{m.sub_type || '—'}</td>
                    <td style={{ color: '#dc2626', filter: strengthened ? undefined : 'blur(5px)', userSelect: strengthened ? undefined : 'none' }}>{m.wrong}</td>
                    <td style={{ color: '#16a34a', filter: strengthened ? undefined : 'blur(5px)', userSelect: strengthened ? undefined : 'none' }}>{m.correct}</td>
                    <td><span className="badge badge-grey" style={{ textTransform: 'capitalize' }}>{m.section || '—'}</span></td>
                    <td className="num">{m.recurrence_count}x</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)} style={{
                  background: p === page ? 'var(--teal-50)' : '#fff',
                  border: `1px solid ${p === page ? 'var(--teal-700)' : '#e6e8eb'}`,
                  color: p === page ? 'var(--teal-700)' : '#1f2937',
                  fontWeight: p === page ? 700 : 400,
                  padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                }}>{p}</button>
              ))}
            </div>
          )}
        </div>

        {/* ── Recurring mistakes ── */}
        {top_mistakes.length > 0 && (
          <>
            <div className="section-title">Recurring Mistakes (seen 2+ times)</div>
            <div className="table-card section-gap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Sub-type</th>
                    <th>Wrong</th>
                    <th>Correct</th>
                    <th className="num">Times</th>
                    <th>Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {top_mistakes.map((m) => {
                    const strengthened = m.remediation_status === 'engaged' || m.remediation_status === 'mastered'
                    return (
                    <tr key={m.id} className="clickable-row"
                      title={!strengthened ? '🔒 Complete "Strengthen This Pattern" to reveal' : undefined}
                      onClick={() => router.push(`/dashboard/grammar/mistakes/${m.id}`)}>
                      <td style={{ fontWeight: 600 }}>{m.category}</td>
                      <td style={{ color: '#6b7280' }}>{m.sub_type || '—'}</td>
                      <td style={{ color: '#dc2626', filter: strengthened ? undefined : 'blur(5px)', userSelect: strengthened ? undefined : 'none' }}>{m.wrong}</td>
                      <td style={{ color: '#16a34a', filter: strengthened ? undefined : 'blur(5px)', userSelect: strengthened ? undefined : 'none' }}>{m.correct}</td>
                      <td className="num">
                        <span className={`badge ${badgeClass(m.recurrence_count, 3, 2)}`}>{m.recurrence_count}x</span>
                      </td>
                      <td>
                        <span className={`badge ${m.reviewed ? 'badge-good' : 'badge-mid'}`}>
                          {m.reviewed ? 'Yes' : 'No'}
                        </span>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Bottom nav ── */}
        <div className="nav-cards-grid section-gap">
          <Link href="/dashboard" className="nav-card">← Overview</Link>
          <Link href="/dashboard/writing" className="nav-card">Writing Details →</Link>
          <Link href="/dashboard/speaking" className="nav-card">Speaking Details →</Link>
        </div>

      </div>
    </>
  )
}

export default function GrammarDashPage() {
  return <RequireAuth><GrammarDashContent /></RequireAuth>
}
