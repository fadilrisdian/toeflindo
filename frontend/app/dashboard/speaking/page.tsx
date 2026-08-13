'use client'

import { AnnotatedSentence } from '@/components/CorrectionPopover'
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
interface SpeakingData {
  totals: {
    total_practices: number; study_days: number; avg_score: number
    listen_repeat_total: number; listen_repeat_avg: number | null
    interview_total: number; interview_avg: number | null
  }
  sessions: { id: number; date: string; task_type: string; score: number; feedback: string; response: string; prompt: string; correct_answer?: string }[]
  task_breakdown: { task_type: string; attempts: number; avg_score: number; min_score: number; max_score: number }[]
  task_daily: {
    lr: { day: string; avg: number | null; n: number }[]
    iv: { day: string; avg: number | null; n: number }[]
  }
  grammar_mistakes: { id: number; date: string; grammar_type: string; wrong: string; correct: string; explanation: string; task_type: string; remediation_status: string | null }[]
  checklist_history: {
    id: number
    date: string
    task_type: string
    results: { item: number; text: string; passed: boolean }[]
    passed_count: number
    total_count: number
  }[]
}

const TARGET_SPEAKING = 5.0
const PAGE_SIZE = 10

// ── Speaking band conversion (mirrors backend _RAW_TO_BAND) ────────────────
// Total raw = sum of 11 task scores (0-5 each) = max 55
// Breakdown: 7 Listen & Repeat + 4 Take an Interview
const _SP_BAND_TABLE: { band: number; raw: [number, number] }[] = [
  { band: 6.0, raw: [52, 55] },
  { band: 5.5, raw: [48, 51] },
  { band: 5.0, raw: [43, 47] },
  { band: 4.5, raw: [37, 42] },
  { band: 4.0, raw: [32, 36] },
  { band: 3.5, raw: [26, 31] },
  { band: 3.0, raw: [21, 25] },
  { band: 2.5, raw: [15, 20] },
  { band: 2.0, raw: [10, 14] },
  { band: 1.5, raw: [4,   9] },
  { band: 1.0, raw: [0,   3] },
]

function speakingRawToBand(raw: number): number {
  const r = Math.max(0, Math.min(55, Math.round(raw)))
  for (const row of _SP_BAND_TABLE) {
    if (r >= row.raw[0] && r <= row.raw[1]) return row.band
  }
  return 1.0
}

/** Estimate total raw (0-55) from per-task-type averages.
 *  Uses 7 L&R tasks + 4 Interview tasks (ETS TOEFL Speaking section). */
function estimateSpeakingRaw(lrAvg: number | null, ivAvg: number | null): number | null {
  if (lrAvg == null && ivAvg == null) return null
  const lr = (lrAvg ?? 0) * 7
  const iv = (ivAvg ?? 0) * 4
  return Math.round(lr + iv)
}

function spBandColor(band: number): string {
  if (band >= 5.5) return 'var(--green)'
  if (band >= 4.5) return '#2c7873'
  if (band >= 3.5) return 'var(--amber)'
  return 'var(--red)'
}

function rollingAvg(vals: (number | null)[], w: number): (number | null)[] {
  return vals.map((_, i) => {
    const win = vals.slice(Math.max(0, i - w + 1), i + 1).filter(v => v != null) as number[]
    return win.length ? parseFloat((win.reduce((a, b) => a + b, 0) / win.length).toFixed(2)) : null
  })
}

function volRadius(n: number) { return Math.max(3, Math.min(10, n * 1.8)) }

function badgeClass(score: number) {
  return score >= 4.5 ? 'badge-good' : score >= 3 ? 'badge-mid' : 'badge-bad'
}

// ── Trend Chart (L&R or Interview) ─────────────────────────────────────────
function TrendChart({ days, color }: {
  days: { day: string; avg: number | null; n: number }[]
  color: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current || !days.length) return
    const vals  = days.map(d => d.avg)
    const roll  = rollingAvg(vals, 7)
    const first = days[0]?.day
    const last  = days[days.length - 1]?.day
    const targetData = first && last
      ? [{ x: first as unknown as number, y: TARGET_SPEAKING }, { x: last as unknown as number, y: TARGET_SPEAKING }]
      : []

    const chart = new Chart(ref.current, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Daily Avg',
            data: days.map(d => ({ x: d.day as unknown as number, y: d.avg as number })),
            borderColor: 'rgba(0,0,0,0)',  // invisible line — dots only
            backgroundColor: 'transparent',
            fill: false, tension: 0, spanGaps: false,
            pointRadius: days.map(d => d.avg != null ? volRadius(d.n) : 0),
            pointBackgroundColor: color + '99',
            pointBorderColor: color,
            pointBorderWidth: 1, borderWidth: 0, order: 2,
          },
          {
            label: '7-Day Rolling',
            data: days.map((d, i) => ({ x: d.day as unknown as number, y: roll[i] as number })),
            borderColor: color,
            backgroundColor: color + '12',
            fill: true, tension: 0.4, pointRadius: 0,
            borderWidth: 2.5, spanGaps: true, order: 1,
          },
          {
            label: 'Target 5.0',
            data: targetData,
            borderColor: 'rgba(22,163,74,0.45)',
            backgroundColor: 'transparent',
            fill: false, tension: 0, pointRadius: 0,
            borderWidth: 1.5,
            borderDash: [5, 4],
            spanGaps: true, order: 3,
          } as never,
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { labels: { color: '#6b7280', font: { size: 11 }, usePointStyle: true, pointStyleWidth: 8 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.dataset.label === 'Target 5.0') return 'Target: 5.0'
                const v = ctx.parsed.y
                return ctx.dataset.label + ': ' + (v != null ? v.toFixed(2) : 'no practice')
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day', displayFormats: { day: 'MMM d' } },
            ticks: { color: '#9ca3af', maxTicksLimit: 10, font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            min: 1, max: 6,
            ticks: { color: '#9ca3af', stepSize: 1 },
            grid: { color: '#f1f2f4' },
          },
        },
      },
    })
    return () => chart.destroy()
  }, [days, color])

  return <div style={{ position: 'relative', height: 280 }}><canvas ref={ref} /></div>
}

// ── Performance by Task Type (horizontal bar) ───────────────────────────────
function PerfChart({ data }: { data: SpeakingData['task_breakdown'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !data.length) return
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: data.map(t => t.task_type),
        datasets: [{
          label: 'Avg Score',
          data: data.map(t => t.avg_score),
          backgroundColor: 'rgba(44,120,115,0.15)',
          borderColor: '#2c7873',
          borderWidth: 2, borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            min: 0, max: 6,
            ticks: { color: '#9ca3af', stepSize: 1 },
            grid: { color: '#f1f2f4' },
          },
          y: {
            ticks: { color: '#374151', font: { size: 12 } },
            grid: { display: false },
          },
        },
      },
    })
    return () => chart.destroy()
  }, [data])
  return <div style={{ position: 'relative', height: Math.max(120, data.length * 50 + 40) }}><canvas ref={ref} /></div>
}

// ── Main page ───────────────────────────────────────────────────────────────

type SessionFilter = 'all' | 'lnr' | 'interview'

function SpeakingDashContent() {
  const [data, setData] = useState<SpeakingData | null>(null)
  const [err, setErr] = useState('')
  const router = useRouter()
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [sessionPage, setSessionPage] = useState(1)
  const [gmPage, setGmPage] = useState(1)
  const [clTab, setClTab] = useState<'Listen and Repeat' | 'Take an Interview'>('Listen and Repeat')

  useEffect(() => {
    api.get<SpeakingData>('/api/dashboard/speaking').then(setData).catch(e => setErr(e.message))
  }, [])

  if (err) return <p style={{ color: '#dc2626', padding: '1.5rem' }}>{err}</p>
  if (!data) return <><Topbar /><p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p></>

  const { totals, sessions, task_breakdown, task_daily, grammar_mistakes, checklist_history } = data

  const filteredSessions = sessions.filter(s => {
    if (sessionFilter === 'lnr') return s.task_type === 'Listen and Repeat'
    if (sessionFilter === 'interview') return s.task_type === 'Take an Interview'
    return true
  })
  const sessionTotalPages = Math.ceil(filteredSessions.length / PAGE_SIZE)
  const pagedSessions = filteredSessions.slice((sessionPage - 1) * PAGE_SIZE, sessionPage * PAGE_SIZE)

  const gmTotalPages = Math.ceil((grammar_mistakes || []).length / PAGE_SIZE)
  const pagedGm = (grammar_mistakes || []).slice((gmPage - 1) * PAGE_SIZE, gmPage * PAGE_SIZE)

  return (
    <>
      <Topbar />
      <div className="db-container">

        {/* ── KPI Cards ── */}
        <div className="skills-grid section-gap">

          {/* Overall card — raw score + band */}
          {(() => {
            const totalRaw = estimateSpeakingRaw(totals.listen_repeat_avg, totals.interview_avg)
            const band = totalRaw != null ? speakingRawToBand(totalRaw) : null
            const bc = band != null ? spBandColor(band) : '#9ca3af'
            const targetRaw = 43  // min raw for band 5.0
            return (
              <div className="skill-card">
                <div className="skill-card-top">
                  <span className="target-pill">Target 5.0 band</span>
                </div>
                <div className="skill-name">Total Raw Score</div>
                <div className="skill-score" style={{ color: bc }}>
                  {totalRaw != null ? totalRaw : '—'}<span className="max"> / 55</span>
                </div>
                {band != null && (
                  <div className="skill-gap" style={{ color: bc }}>
                    Band {band.toFixed(1)} / 6.0
                  </div>
                )}
                {totalRaw != null && (
                  <div className="skill-gap bad" style={{ color: '#9ca3af', fontSize: '0.72rem' }}>
                    {totalRaw >= targetRaw
                      ? `↑ ${totalRaw - targetRaw} pts above band 5.0`
                      : `↓ ${targetRaw - totalRaw} pts to band 5.0`}
                  </div>
                )}
                <div className="skill-meta">{totals.total_practices} sessions · {totals.study_days} study days</div>
              </div>
            )
          })()}

          {/* Per-task raw contribution cards */}
          {([
            { label: 'Listen & Repeat',   avg: totals.listen_repeat_avg,  taskCount: 7, sessions: totals.listen_repeat_total,  color: '#ec4899' },
            { label: 'Take an Interview', avg: totals.interview_avg,       taskCount: 4, sessions: totals.interview_total,       color: '#8b5cf6' },
          ] as const).map(({ label, avg, taskCount, sessions, color }) => {
            const rawMax  = taskCount * 5
            const rawPts  = avg != null ? Math.round(avg * taskCount * 10) / 10 : null
            const gap     = rawPts != null ? (rawPts - rawMax).toFixed(1) : null
            const isGood  = gap != null && parseFloat(gap) >= 0
            return (
              <div key={label} className="skill-card">
                <div className="skill-card-top">
                  <span className="target-pill">{rawMax} raw pts max</span>
                </div>
                <div className="skill-name">{label}</div>
                <div className="skill-score" style={{ color: rawPts != null ? color : '#9ca3af' }}>
                  {rawPts != null ? rawPts : '—'}<span className="max"> / {rawMax}</span>
                </div>
                {gap != null && (
                  <div className={`skill-gap ${isGood ? 'good' : 'bad'}`}>
                    {isGood ? `↑ full marks` : `↓ ${Math.abs(parseFloat(gap))} pts below max`}
                  </div>
                )}
                <div className="skill-meta">
                  {avg != null ? `avg ${avg.toFixed(1)}/5 · ` : ''}{sessions} sessions
                </div>
              </div>
            )
          })}

        </div>

        {/* ── Two trend charts side by side ── */}
        <div className="charts-grid section-gap">
          <div className="chart-card">
            <h3>Listen &amp; Repeat — Score Trend</h3>
            <div className="chart-subtitle">
              Dot size = session volume · line = 7-day rolling avg · dashed = target 5.0
            </div>
            {task_daily.lr.length > 0
              ? <TrendChart days={task_daily.lr} color="#2c7873" />
              : <p className="empty-note">No Listen & Repeat sessions yet.</p>
            }
          </div>
          <div className="chart-card">
            <h3>Take an Interview — Score Trend</h3>
            <div className="chart-subtitle">
              Dot size = session volume · line = 7-day rolling avg · dashed = target 5.0
            </div>
            {task_daily.iv.length > 0
              ? <TrendChart days={task_daily.iv} color="#4f6ba0" />
              : <p className="empty-note">No Interview sessions yet.</p>
            }
          </div>
        </div>

        {/* ── Performance by Task + Progress chart ── */}
        <div className="charts-grid section-gap">
          <div className="chart-card">
            <h3>Performance by Task Type</h3>
            {task_breakdown.length > 0
              ? <PerfChart data={task_breakdown} />
              : <p className="empty-note">No data yet.</p>
            }
          </div>

          {/* Task breakdown table */}
          <div className="chart-card">
            <h3>Task Breakdown</h3>
            <table>
              <thead>
                <tr>
                  <th>Task Type</th>
                  <th className="num">n</th>
                  <th className="num">Avg</th>
                  <th className="num">Range</th>
                </tr>
              </thead>
              <tbody>
                {task_breakdown.map(t => (
                  <tr key={t.task_type}>
                    <td style={{ fontWeight: 600 }}>{t.task_type}</td>
                    <td className="num">{t.attempts}</td>
                    <td className="num"><span className={`badge ${badgeClass(t.avg_score)}`}>{t.avg_score}</span></td>
                    <td className="num">{t.min_score} – {t.max_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Session Tables ── */}
        {/* ── Recent Speaking Sessions ── */}
        <div className="section-title">Recent Speaking Sessions</div>
        <div className="table-card section-gap">
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {([['all', 'All'], ['lnr', 'Listen & Repeat'], ['interview', 'Take an Interview']] as [SessionFilter, string][]).map(([val, label]) => (
              <button key={val} onClick={() => { setSessionFilter(val); setSessionPage(1) }}
                style={{
                  padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', cursor: 'pointer', fontWeight: sessionFilter === val ? 700 : 400,
                  background: sessionFilter === val ? 'var(--teal-700)' : '#fff',
                  color: sessionFilter === val ? '#fff' : '#374151',
                  border: `1px solid ${sessionFilter === val ? 'var(--teal-700)' : '#e6e8eb'}`,
                }}>
                {label}
              </button>
            ))}
            <span style={{ fontSize: '0.8rem', color: '#6b7280', marginLeft: 'auto' }}>{filteredSessions.length} sessions</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="num">Score</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {pagedSessions.length === 0 ? (
                <tr><td colSpan={4} className="empty-note" style={{ padding: '1rem 0.7rem' }}>No sessions yet.</td></tr>
              ) : pagedSessions.map((s) => (
                <tr key={s.id} className="clickable-row" onClick={() => router.push(`/dashboard/speaking/sessions/${s.id}`)}>
                  <td style={{ color: '#9ca3af' }}>{s.date.slice(0, 10)}</td>
                  <td style={{ color: '#6b7280', fontSize: '0.82rem' }}>{s.task_type}</td>
                  <td className="num"><span className={`badge ${badgeClass(s.score)}`}>{s.score}</span></td>
                  <td className="feedback-cell">{s.feedback || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sessionTotalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {Array.from({ length: sessionTotalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setSessionPage(p)} style={{
                  background: p === sessionPage ? 'var(--teal-50)' : '#fff',
                  border: `1px solid ${p === sessionPage ? 'var(--teal-700)' : '#e6e8eb'}`,
                  color: p === sessionPage ? 'var(--teal-700)' : '#1f2937',
                  fontWeight: p === sessionPage ? 700 : 400,
                  padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                }}>{p}</button>
              ))}
            </div>
          )}
        </div>

        {/* ── Grammar Mistakes from Take an Interview ── */}
        {(grammar_mistakes || []).length > 0 && (
          <>
            <div className="section-title">Grammar Mistakes from Take an Interview</div>
            <div className="table-card section-gap">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{grammar_mistakes.length} mistakes</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Wrong</th>
                    <th>Correct</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedGm.map((m) => {
                    const strengthened = m.remediation_status === 'engaged' || m.remediation_status === 'mastered'
                    return (
                    <tr
                      key={m.id}
                      className="clickable-row"
                      title={!strengthened ? '🔒 Complete "Strengthen This Pattern" to reveal' : undefined}
                      onClick={() => router.push(`/dashboard/grammar/mistakes/${m.id}`)}
                    >
                      <td style={{ color: '#9ca3af' }}>{(m.date || '').slice(0, 10)}</td>
                      <td style={{ color: '#6b7280' }}>{m.grammar_type}</td>
                      <td style={{ color: '#dc2626', filter: strengthened ? undefined : 'blur(5px)', userSelect: strengthened ? undefined : 'none' }}>{m.wrong}</td>
                      <td style={{ color: '#16a34a', filter: strengthened ? undefined : 'blur(5px)', userSelect: strengthened ? undefined : 'none' }}>{m.correct}</td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
              {gmTotalPages > 1 && (
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => setGmPage(p => Math.max(1, p - 1))} disabled={gmPage === 1}
                    style={{ background: '#fff', border: '1px solid #e6e8eb', color: gmPage === 1 ? '#9ca3af' : '#1f2937', padding: '0.3rem 0.7rem', borderRadius: 4, cursor: gmPage === 1 ? 'default' : 'pointer', fontSize: '0.8rem' }}>‹</button>
                  {Array.from({ length: gmTotalPages }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setGmPage(p)} style={{
                      background: p === gmPage ? 'var(--teal-50)' : '#fff',
                      border: `1px solid ${p === gmPage ? 'var(--teal-700)' : '#e6e8eb'}`,
                      color: p === gmPage ? 'var(--teal-700)' : '#1f2937',
                      fontWeight: p === gmPage ? 700 : 400,
                      padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                    }}>{p}</button>
                  ))}
                  <button onClick={() => setGmPage(p => Math.min(gmTotalPages, p + 1))} disabled={gmPage === gmTotalPages}
                    style={{ background: '#fff', border: '1px solid #e6e8eb', color: gmPage === gmTotalPages ? '#9ca3af' : '#1f2937', padding: '0.3rem 0.7rem', borderRadius: 4, cursor: gmPage === gmTotalPages ? 'default' : 'pointer', fontSize: '0.8rem' }}>›</button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Checklist History Matrix ── */}
        {(() => {
          const filtered = (checklist_history || []).filter(r => r.task_type === clTab)
          const items = filtered.length > 0 ? filtered[filtered.length - 1].results : []
          return (
            <>
              <div className="section-title">Checklist History</div>
              <div className="table-card section-gap">
                {/* Tab pills */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {(['Listen and Repeat', 'Take an Interview'] as const).map(tt => (
                    <button key={tt} onClick={() => setClTab(tt)}
                      style={{
                        padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', cursor: 'pointer',
                        fontWeight: clTab === tt ? 700 : 400,
                        background: clTab === tt ? 'var(--teal-700)' : '#fff',
                        color: clTab === tt ? '#fff' : '#374151',
                        border: `1px solid ${clTab === tt ? 'var(--teal-700)' : '#e6e8eb'}`,
                      }}>
                      {tt === 'Listen and Repeat' ? 'L&R' : 'Interview'}
                    </button>
                  ))}
                  <span style={{ fontSize: '0.8rem', color: '#6b7280', marginLeft: 'auto' }}>
                    {filtered.length} run{filtered.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {filtered.length === 0 ? (
                  <p className="empty-note">No checklist runs for {clTab} yet.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'auto' }}>
                      <thead>
                        <tr>
                          <th style={{
                            textAlign: 'left', fontSize: '0.78rem', color: '#6b7280',
                            padding: '6px 10px 6px 4px', borderBottom: '1px solid #e5e7eb',
                            whiteSpace: 'nowrap', minWidth: 220, fontWeight: 600,
                          }}>Checklist Item</th>
                          {filtered.map(run => (
                            <th key={run.id} style={{
                              textAlign: 'center', fontSize: '0.72rem', color: '#2a7a7a',
                              padding: '6px 8px', borderBottom: '1px solid #e5e7eb',
                              whiteSpace: 'nowrap', fontWeight: 600, minWidth: 58,
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
                                <td key={run.id} style={{
                                  textAlign: 'center', fontSize: '0.9rem',
                                  padding: '6px 8px', borderBottom: '1px solid #f3f4f6',
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
          <Link href="/dashboard/writing" className="nav-card">Writing Details →</Link>
          <Link href="/dashboard/grammar" className="nav-card">Grammar Details →</Link>
        </div>

      </div>


    </>
  )
}

export default function SpeakingDashPage() {
  return <RequireAuth><SpeakingDashContent /></RequireAuth>
}
