'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'
import { Chart, registerables } from 'chart.js'
import 'chartjs-adapter-date-fns'

Chart.register(...registerables)
Chart.defaults.color = '#6b7280'

// ── Types ───────────────────────────────────────────────────────────────────
interface WritingData {
  totals: { total_practices: number; study_days: number; avg_score: number; assisted_avg: number | null }
  sessions: { id: number; date: string; task_type: string; score: number; feedback: string; response: string; prompt: string }[]
  task_breakdown: { task_type: string; attempts: number; avg_score: number; min_score: number; max_score: number; days_practiced: number }[]
  weekly_trend: { week: string; sessions: number; avg_score: number }[]
  error_types: { grammar_type: string; cnt: number }[]
  grammar_mistakes: { id: number; date: string; grammar_type: string; wrong: string; correct: string; explanation: string; section: string; task_type: string; remediation_status: string | null }[]
  checklist_history: {
    id: number
    date: string
    task_type: string
    results: { item: number; text: string; passed: boolean; note: string }[]
    passed_count: number
    total_count: number
    improvement_note: string
  }[]
}

type Tab = 'Build a Sentence' | 'Write an Email' | 'Write for an Academic Discussion'
type Range = 30 | 90 | 180 | 365

const WRITING_TARGETS: Record<string, number> = {
  'Build a Sentence': 6,
  'Write an Email': 5,
  'Write for an Academic Discussion': 5,
}
const TAB_COLOR: Record<Tab, string> = {
  'Build a Sentence': '#6c7fe8',
  'Write an Email': '#2fbf94',
  'Write for an Academic Discussion': '#e0b64a',
}

// ── Score structure (per spec) ───────────────────────────────────────────────
const TASK_RAW_MAX: Record<string, number> = {
  'Build a Sentence': 10,
  'Write an Email': 5,
  'Write for an Academic Discussion': 5,
}
const TASK_STORED_MAX: Record<string, number> = {
  'Build a Sentence': 6,
  'Write an Email': 5,
  'Write for an Academic Discussion': 5,
}
const TASK_TIME: Record<string, string> = {
  'Build a Sentence': '—',
  'Write an Email': '7 min',
  'Write for an Academic Discussion': '10 min',
}
const TASK_METHOD: Record<string, string> = {
  'Build a Sentence': 'Machine-scored',
  'Write an Email': 'AI + Human Rubric',
  'Write for an Academic Discussion': 'AI + Human Rubric',
}

// Convert stored score → raw points contribution
function toRawPts(taskType: string, storedScore: number): number {
  const sMax = TASK_STORED_MAX[taskType] ?? 5
  const rMax = TASK_RAW_MAX[taskType] ?? 5
  if (taskType === 'Build a Sentence') {
    // BAS items stored as 6.0 (correct) or 0.0 (wrong); map [0,6]→[0,10]
    return Math.round((storedScore / 6) * rMax * 10) / 10
  }
  // Email / Discussion stored 0-5; raw max = 5
  return Math.round((storedScore / sMax) * rMax * 10) / 10
}

// Band conversion table (writing raw out of 20)
const BAND_TABLE: { band: number; raw: [number, number] }[] = [
  { band: 6.0,  raw: [19, 20] },
  { band: 5.5,  raw: [17, 18] },
  { band: 5.0,  raw: [15, 16] },
  { band: 4.5,  raw: [13, 14] },
  { band: 4.0,  raw: [11, 12] },
  { band: 3.5,  raw: [9,  10] },
  { band: 3.0,  raw: [7,   8] },
  { band: 2.5,  raw: [5,   6] },
  { band: 2.0,  raw: [3,   4] },
  { band: 1.5,  raw: [2,   2] },
  { band: 1.0,  raw: [0,   1] },
]

function rawToBand(raw: number): number {
  for (const row of BAND_TABLE) {
    if (raw >= row.raw[0] && raw <= row.raw[1]) return row.band
  }
  return raw > 20 ? 6.0 : 1.0
}

function bandColor(band: number): string {
  if (band >= 5.5) return 'var(--green)'
  if (band >= 4.5) return '#2c7873'
  if (band >= 3.5) return 'var(--amber)'
  return 'var(--red)'
}

function filterByDays(sessions: WritingData['sessions'], days: Range) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return sessions.filter(s => new Date(s.date) >= cutoff)
}

// ── Progress Line Chart ─────────────────────────────────────────────────────
function ProgressChart({ sessions, tab, range }: { sessions: WritingData['sessions']; tab: Tab; range: Range }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!ref.current) return
    chartRef.current?.destroy()

    const filtered = filterByDays(sessions.filter(s => s.task_type === tab), range)
    const color = TAB_COLOR[tab]
    const yMax = WRITING_TARGETS[tab] ?? 5
    const targetScore = WRITING_TARGETS[tab] ?? 5
    const targetLabel = tab === 'Build a Sentence' ? 'Target 6' : `Target ${targetScore}`

    chartRef.current = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: filtered.map(s => s.date.slice(0, 10)),
        datasets: [{
          label: tab,
          data: filtered.map(s => s.score),
          borderColor: color,
          backgroundColor: color + '22',
          fill: true, tension: 0.35, pointRadius: 4,
          pointBackgroundColor: color, borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `Score: ${ctx.parsed.y}` } },
        },
        scales: {
          y: {
            min: 0, max: yMax,
            ticks: { color: '#9ca3af', stepSize: 1 },
            grid: { color: '#f1f2f4' },
          },
          x: {
            ticks: { color: '#9ca3af', maxTicksLimit: 8, font: { size: 10 } },
            grid: { display: false },
          },
        },
        // target line via afterDraw plugin
      },
      plugins: [{
        id: 'targetLine',
        afterDraw(chart) {
          const { ctx, scales, chartArea } = chart
          if (!scales.y || !chartArea) return
          const y = scales.y.getPixelForValue(targetScore)
          ctx.save()
          ctx.beginPath()
          ctx.setLineDash([5, 4])
          ctx.strokeStyle = 'rgba(22,163,74,0.55)'
          ctx.lineWidth = 1.5
          ctx.moveTo(chartArea.left, y)
          ctx.lineTo(chartArea.right, y)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.font = '10px sans-serif'
          ctx.fillStyle = '#16a34a'
          ctx.fillText(targetLabel, chartArea.right - 56, y - 4)
          ctx.restore()
        },
      }],
    })

    return () => { chartRef.current?.destroy() }
  }, [sessions, tab, range])

  return <div style={{ position: 'relative', height: 240 }}><canvas ref={ref} /></div>
}

// ── Weekly Momentum Bar Chart ───────────────────────────────────────────────
function MomentumChart({ data }: { data: WritingData['weekly_trend'] }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current || !data.length) return
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: data.map(w => w.week),
        datasets: [{
          label: 'Avg Score',
          data: data.map(w => w.avg_score),
          backgroundColor: 'rgba(44,120,115,0.55)',
          borderColor: '#2c7873',
          borderWidth: 1.5, borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            min: 0, max: 6,
            ticks: { color: '#9ca3af', stepSize: 1 },
            grid: { color: '#f1f2f4' },
          },
          x: {
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid: { display: false },
          },
        },
      },
    })
    return () => chart.destroy()
  }, [data])

  return <div style={{ position: 'relative', height: 240 }}><canvas ref={ref} /></div>
}

// ── Mini sparkline ──────────────────────────────────────────────────────────
function Sparkline({ scores }: { scores: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || scores.length < 2) return
    const last = scores[scores.length - 1]
    const prev = scores[scores.length - 2]
    const color = last >= prev ? '#2c7873' : '#9ca3af'
    const chart = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: scores.map((_, i) => String(i)),
        datasets: [{ data: scores, borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.3 }],
      },
      options: {
        responsive: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        animation: false,
      },
    })
    return () => chart.destroy()
  }, [scores])
  return <canvas ref={ref} width={70} height={28} />
}

// ── Main page ───────────────────────────────────────────────────────────────
const TABS: Tab[] = ['Build a Sentence', 'Write an Email', 'Write for an Academic Discussion']
const RANGES: { label: string; value: Range }[] = [
  { label: '1m', value: 30 }, { label: '3m', value: 90 },
  { label: '6m', value: 180 }, { label: '1y', value: 365 },
]
const PAGE_SIZE = 10

function WritingDashContent() {
  const [data, setData] = useState<WritingData | null>(null)
  const [err, setErr] = useState('')
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('Build a Sentence')
  const [range, setRange] = useState<Range>(30)
  const [page, setPage] = useState(1)
  const [filterTask, setFilterTask] = useState('')
  const [clFilter, setClFilter] = useState<'Write an Email' | 'Write for an Academic Discussion'>('Write an Email')
  const [clModal, setClModal] = useState<WritingData['checklist_history'][0] | null>(null)
  const [gmPage, setGmPage] = useState(1)

  useEffect(() => {
    api.get<WritingData>('/api/dashboard/writing').then(setData).catch(e => setErr(e.message))
  }, [])

  if (err) return <p style={{ color: '#dc2626', padding: '1.5rem' }}>{err}</p>
  if (!data) return <><Topbar /><p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p></>

  const { totals, sessions, task_breakdown, weekly_trend, error_types, grammar_mistakes, checklist_history } = data

  // Recent sessions — API returns newest-first (ORDER BY date DESC), keep that order
  const filteredSessions = sessions
    .filter(s => !filterTask || s.task_type === filterTask)
  const totalPages = Math.ceil(filteredSessions.length / PAGE_SIZE)
  const pageSessions = filteredSessions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Sparkline data per task type (last 6 scores)
  function sparkScores(tt: string) {
    return sessions.filter(s => s.task_type === tt).slice(-6).map(s => s.score)
  }

  function badgeClass(avg: number) {
    return avg >= 4.5 ? 'badge-good' : avg >= 3 ? 'badge-mid' : 'badge-bad'
  }
  function freqClass(cnt: number, total: number) {
    const pct = total > 0 ? cnt / total : 0
    return pct >= 0.3 ? 'pill-high' : pct >= 0.15 ? 'pill-medium' : 'pill-low'
  }
  const totalErrors = error_types.reduce((s, e) => s + e.cnt, 0)

  return (
    <>
      <Topbar />
      <div className="db-container">

        {/* ── KPI Stat Cards ── */}
        <div className="skills-grid section-gap">
          {/* Overall Raw Score + Band */}
          {(() => {
            const TASK_ORDER = ['Build a Sentence', 'Write an Email', 'Write for an Academic Discussion']
            const totalRaw = TASK_ORDER.reduce((sum, tt) => {
              const t = task_breakdown.find(x => x.task_type === tt)
              return t ? sum + toRawPts(tt, t.avg_score) : sum
            }, 0)
            const roundedRaw = Math.round(totalRaw)
            const band = rawToBand(roundedRaw)
            const bc = bandColor(band)
            return (
              <div className="skill-card">
                <div className="skill-card-top">
                  <span className="target-pill">Target 5.5 band</span>
                </div>
                <div className="skill-name">Total Raw Score</div>
                <div className="skill-score" style={{ color: bc }}>
                  {roundedRaw}<span className="max"> / 20</span>
                </div>
                <div className="skill-gap" style={{ color: bc }}>
                  Band {band.toFixed(1)} / 6.0
                </div>
                <div className="skill-meta">{totals.total_practices} sessions · {totals.study_days} study days</div>
                {totals.assisted_avg != null && totals.assisted_avg !== totals.avg_score && (
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 3 }}>
                    With revisions: {totals.assisted_avg.toFixed(2)}
                  </div>
                )}
              </div>
            )
          })()}
          {/* Per-task raw points */}
          {['Build a Sentence', 'Write an Email', 'Write for an Academic Discussion'].map(tt => {
            const t = task_breakdown.find(x => x.task_type === tt)
            const rMax = TASK_RAW_MAX[tt]
            const sMax = TASK_STORED_MAX[tt]
            const rawPts = t ? toRawPts(tt, t.avg_score) : null
            const gap = rawPts != null ? (rawPts - rMax).toFixed(1) : null
            const isGood = gap != null && parseFloat(gap) >= 0
            const color = TAB_COLOR[tt as Tab] || '#1f2937'
            return (
              <div key={tt} className="skill-card">
                <div className="skill-card-top">
                  <span className="target-pill">{rMax} raw pts max</span>
                </div>
                <div className="skill-name">{tt}</div>
                <div className="skill-score" style={{ color }}>
                  {rawPts != null ? rawPts : '—'}<span className="max"> / {rMax}</span>
                </div>
                {t && (
                  <div className={`skill-gap ${isGood ? 'good' : 'bad'}`}>
                    {isGood ? `↑ full marks` : `↓ ${Math.abs(parseFloat(gap!))} pts below max`}
                  </div>
                )}
                <div className="skill-meta">
                  {t ? `avg ${t.avg_score}/${sMax} · ${t.attempts} tries` : 'no data'}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Row 1: Progress + Weekly Momentum ── */}
        <div className="dash-grid-w section-gap">
          <div className="card-w">
            <h2>Progress</h2>
            <div className="tabs-row">
              {TABS.map(t => (
                <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`}
                  onClick={() => setTab(t)}>
                  {t === 'Write for an Academic Discussion' ? 'Academic Discussion' : t}
                </button>
              ))}
            </div>
            <ProgressChart sessions={sessions} tab={tab} range={range} />
            <div className="range-row">
              {RANGES.map(r => (
                <button key={r.value} className={`range-btn-w ${range === r.value ? 'active' : ''}`}
                  onClick={() => setRange(r.value)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card-w">
            <h2>Weekly Momentum</h2>
            <MomentumChart data={weekly_trend} />
          </div>
        </div>

        {/* ── Row 2: Task Type Comparison + Common Errors ── */}
        <div className="dash-grid-w section-gap">
          <div className="card-w">
            <h2>Task Type Comparison</h2>
            <table>
              <thead>
                <tr>
                  <th>Task Type</th>
                  <th>Avg Score</th>
                  <th className="num">Attempts</th>
                  <th>Trend</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {task_breakdown.map(t => (
                  <tr key={t.task_type}>
                    <td style={{ fontWeight: 600 }}>{t.task_type}</td>
                    <td><span className={`badge ${badgeClass(t.avg_score)}`}>{t.avg_score}</span></td>
                    <td className="num">{t.attempts}</td>
                    <td><Sparkline scores={sparkScores(t.task_type)} /></td>
                    <td>
                      <span className={`pill ${t.avg_score >= 4.5 ? 'pill-confident' : 'pill-improving'}`}>
                        {t.avg_score >= 4.5 ? 'Confident' : 'Improving'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-w">
            <h2>Common Error Types</h2>
            <table>
              <thead>
                <tr>
                  <th>Error Type</th>
                  <th className="num">Count</th>
                  <th>Frequency</th>
                </tr>
              </thead>
              <tbody>
                {error_types.length === 0 ? (
                  <tr><td colSpan={3} className="empty-note">No writing mistakes logged.</td></tr>
                ) : error_types.map(e => (
                  <tr key={e.grammar_type}>
                    <td>{e.grammar_type}</td>
                    <td className="num">{e.cnt}</td>
                    <td><span className={`pill ${freqClass(e.cnt, totalErrors)}`}>
                      {freqClass(e.cnt, totalErrors) === 'pill-high' ? 'High'
                        : freqClass(e.cnt, totalErrors) === 'pill-medium' ? 'Medium' : 'Low'}
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Recent Sessions ── */}
        <div className="section-title">Recent Writing Sessions</div>
        <div className="table-card section-gap">
          <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1rem', alignItems: 'center' }}>
            <select className="filter-select" value={filterTask}
              onChange={e => { setFilterTask(e.target.value); setPage(1) }}>
              <option value="">All task types</option>
              {[...new Set(sessions.map(s => s.task_type))].map(tt => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{filteredSessions.length} sessions</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Task Type</th>
                <th className="num">Raw Pts</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {pageSessions.map((s, i) => {
                // BAS: each row = 1 item, 1 pt max (score 6 = correct = 1 pt, else 0)
                const isBAS = s.task_type === 'Build a Sentence'
                const rPts  = isBAS ? (s.score >= 6 ? 1 : 0) : toRawPts(s.task_type, s.score)
                const rMax  = isBAS ? 1 : (TASK_RAW_MAX[s.task_type] ?? 5)
                const pct   = rPts / rMax
                const bc    = pct >= 0.85 ? 'badge-good' : pct >= 0.6 ? 'badge-mid' : 'badge-bad'
                return (
                  <tr key={i} className="clickable-row" onClick={() => router.push(`/dashboard/writing/sessions/${s.id}`)}>
                    <td style={{ color: '#9ca3af' }}>{s.date.slice(0, 10)}</td>
                    <td>{s.task_type}</td>
                    <td className="num">
                      <span className={`badge ${bc}`}>{rPts}<span style={{ fontWeight:400, opacity:0.6 }}>/{rMax}</span></span>
                    </td>
                    <td className="feedback-cell">{s.feedback || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  style={{
                    background: p === page ? 'var(--teal-50)' : '#fff',
                    border: `1px solid ${p === page ? 'var(--teal-700)' : '#e6e8eb'}`,
                    color: p === page ? 'var(--teal-700)' : '#1f2937',
                    fontWeight: p === page ? 700 : 400,
                    padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                  }}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Grammar Mistakes ── */}
        {grammar_mistakes.length > 0 && (() => {
          const gmTotalPages = Math.ceil(grammar_mistakes.length / PAGE_SIZE)
          const pagedGm = grammar_mistakes.slice((gmPage - 1) * PAGE_SIZE, gmPage * PAGE_SIZE)
          return (
            <>
              <div className="section-title">Grammar Mistakes from Writing</div>
              <div className="table-card section-gap">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{grammar_mistakes.length} mistakes</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Source</th>
                      <th>Wrong</th>
                      <th>Correct</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGm.map((m, i) => {
                      const strengthened = m.remediation_status === 'engaged' || m.remediation_status === 'mastered'
                      return (
                      <tr key={i} className="clickable-row"
                        title={!strengthened ? '🔒 Complete "Strengthen This Pattern" to reveal' : undefined}
                        onClick={() => router.push(`/dashboard/grammar/mistakes/${m.id}`)}>
                        <td style={{ color: '#9ca3af' }}>{(m.date || '').slice(0, 10)}</td>
                        <td style={{ color: '#6b7280' }}>{m.grammar_type}</td>
                        <td style={{ color: '#6b7280', fontSize: '0.78rem' }}>{m.task_type || '—'}</td>
                        <td style={{ color: '#dc2626', filter: strengthened ? undefined : 'blur(5px)', userSelect: strengthened ? undefined : 'none' }}>{m.wrong}</td>
                        <td style={{ color: '#16a34a', filter: strengthened ? undefined : 'blur(5px)', userSelect: strengthened ? undefined : 'none' }}>{m.correct}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
                {gmTotalPages > 1 && (
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setGmPage(p => Math.max(1, p - 1))}
                      disabled={gmPage === 1}
                      style={{
                        background: '#fff', border: '1px solid #e6e8eb',
                        color: gmPage === 1 ? '#9ca3af' : '#1f2937',
                        padding: '0.3rem 0.7rem', borderRadius: 4, cursor: gmPage === 1 ? 'default' : 'pointer', fontSize: '0.8rem',
                      }}>‹</button>
                    {Array.from({ length: gmTotalPages }, (_, i) => i + 1).map(p => (
                      <button key={p} onClick={() => setGmPage(p)}
                        style={{
                          background: p === gmPage ? 'var(--teal-50)' : '#fff',
                          border: `1px solid ${p === gmPage ? 'var(--teal-700)' : '#e6e8eb'}`,
                          color: p === gmPage ? 'var(--teal-700)' : '#1f2937',
                          fontWeight: p === gmPage ? 700 : 400,
                          padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                        }}>{p}</button>
                    ))}
                    <button
                      onClick={() => setGmPage(p => Math.min(gmTotalPages, p + 1))}
                      disabled={gmPage === gmTotalPages}
                      style={{
                        background: '#fff', border: '1px solid #e6e8eb',
                        color: gmPage === gmTotalPages ? '#9ca3af' : '#1f2937',
                        padding: '0.3rem 0.7rem', borderRadius: 4, cursor: gmPage === gmTotalPages ? 'default' : 'pointer', fontSize: '0.8rem',
                      }}>›</button>
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {/* ── Checklist History Matrix ── */}
        {(() => {
          const filtered = (checklist_history || []).filter(r => r.task_type === clFilter)
          // Items come from the most recent run so newly added checklist items are shown
          const items = filtered.length > 0 ? filtered[filtered.length - 1].results : []
          return (
            <>
              <div className="section-title">Checklist History</div>
              <div className="table-card section-gap">
                {/* Filter pills */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {(['Write an Email', 'Write for an Academic Discussion'] as const).map(tt => (
                    <button key={tt} onClick={() => setClFilter(tt)}
                      style={{
                        padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', cursor: 'pointer',
                        fontWeight: clFilter === tt ? 700 : 400,
                        background: clFilter === tt ? 'var(--teal-700)' : '#fff',
                        color: clFilter === tt ? '#fff' : '#374151',
                        border: `1px solid ${clFilter === tt ? 'var(--teal-700)' : '#e6e8eb'}`,
                      }}>
                      {tt === 'Write an Email' ? 'Email' : 'Academic Discussion'}
                    </button>
                  ))}
                  <span style={{ fontSize: '0.8rem', color: '#6b7280', marginLeft: 'auto' }}>
                    {filtered.length} run{filtered.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {filtered.length === 0 ? (
                  <p className="empty-note">No checklist runs for {clFilter} yet.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'auto' }}>
                      <thead>
                        <tr>
                          {/* First col: item label */}
                          <th style={{
                            textAlign: 'left', fontSize: '0.78rem', color: '#6b7280',
                            padding: '6px 10px 6px 4px', borderBottom: '1px solid #e5e7eb',
                            whiteSpace: 'nowrap', minWidth: 220, fontWeight: 600,
                          }}>Checklist Item</th>
                          {/* One col per run */}
                          {filtered.map((run, ci) => (
                            <th key={run.id}
                              onClick={() => setClModal(run)}
                              title={run.improvement_note}
                              style={{
                                textAlign: 'center', fontSize: '0.72rem', color: '#2a7a7a',
                                padding: '6px 8px', borderBottom: '1px solid #e5e7eb',
                                whiteSpace: 'nowrap', cursor: 'pointer', fontWeight: 600,
                                minWidth: 58,
                              }}>
                              {run.date.slice(5, 10)}<br />
                              <span style={{ fontSize: '0.68rem', fontWeight: 400, color: '#9ca3af' }}>
                                {run.passed_count}/{run.total_count}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, ri) => (
                          <tr key={item.item} style={{ background: ri % 2 === 0 ? '#fafafa' : '#fff' }}>
                            <td style={{
                              fontSize: '0.78rem', color: '#374151',
                              padding: '6px 10px 6px 4px', borderBottom: '1px solid #f3f4f6',
                              maxWidth: 320,
                            }}>
                              <span style={{ color: '#9ca3af', marginRight: 6 }}>{item.item}.</span>
                              {item.text}
                            </td>
                            {filtered.map(run => {
                              const cell = run.results.find(r => r.item === item.item)
                              return (
                                <td key={run.id} title={cell?.note || ''}
                                  style={{
                                    textAlign: 'center', fontSize: '0.9rem',
                                    padding: '6px 8px', borderBottom: '1px solid #f3f4f6',
                                    cursor: cell?.note ? 'help' : 'default',
                                  }}>
                                  {cell ? (cell.passed ? '✅' : '❌') : '—'}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {/* ── Bottom nav ── */}
        <div className="nav-cards-grid section-gap">
          <Link href="/dashboard" className="nav-card">← Overview</Link>
          <Link href="/dashboard/writing/analyzer" className="nav-card">Writing Analyzer →</Link>
          <Link href="/dashboard/speaking" className="nav-card">Speaking Details →</Link>
          <Link href="/dashboard/grammar" className="nav-card">Grammar Details →</Link>
        </div>

      </div>

      {/* ── Checklist Run Modal ── */}
      {clModal && (
        <div className="modal-overlay" onClick={() => setClModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setClModal(null)}>×</button>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{clModal.date.slice(0, 10)}</span>
              <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{clModal.task_type}</span>
              <span style={{
                fontSize: '0.78rem', fontWeight: 700, padding: '2px 10px', borderRadius: 12,
                background: clModal.passed_count === clModal.total_count ? '#dcfce7' : '#fef9c3',
                color: clModal.passed_count === clModal.total_count ? '#166534' : '#854d0e',
              }}>
                {clModal.passed_count}/{clModal.total_count} passed
              </span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {clModal.results.map(item => (
                <li key={item.item} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '5px 8px', borderRadius: 4,
                  background: item.passed ? '#f0fdf4' : '#fff1f2',
                  border: `1px solid ${item.passed ? '#bbf7d0' : '#fecdd3'}`,
                }}>
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{item.passed ? '✅' : '❌'}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: '0.8rem', color: '#374151' }}>{item.text}</span>
                    {item.note && (
                      <span style={{ display: 'block', fontSize: '0.73rem', color: item.passed ? '#166534' : '#be123c', marginTop: 2 }}>
                        {item.note}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {clModal.improvement_note && (
              <div style={{ padding: '8px 12px', background: '#f0f9ff', borderRadius: 4, border: '1px solid #bae6fd' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0369a1' }}>Next time: </span>
                <span style={{ fontSize: '0.8rem', color: '#0c4a6e' }}>{clModal.improvement_note}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default function WritingDashPage() {
  return <RequireAuth><WritingDashContent /></RequireAuth>
}
