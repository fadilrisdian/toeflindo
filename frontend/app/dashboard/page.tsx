'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'
import { Chart, registerables } from 'chart.js'
import 'chartjs-adapter-date-fns'

Chart.register(...registerables)
Chart.defaults.color = '#6b7280'

// ── Types ──────────────────────────────────────────────────────────────────
interface DashSummary {
  writing: { target: number; overall: number | null; email: number | null; discussion: number | null }
  speaking: { target: number; overall: number | null; listen_repeat: number | null; interview: number | null }
  performance_by_task: { task_type: string; avg_score: number; attempts: number }[]
  daily_scores: { day: string; avg: number | null; n: number; rolling: number | null }[]
  section_kpis: { skill: string; attempts: number; avg_score: number; study_days: number }[]
  grammar_perf: { grammar_type: string; total_attempts: number; accuracy: number }[]
  mistake_trend: { day: string; n: number; cumulative: number }[]
  top_mistakes: { grammar_type: string; count: number; total_recurrence: number; last_seen: string }[]
  task_summary: { task_type: string; attempts: number; avg_score: number; min_score: number; max_score: number }[]
  totals: { total_practices: number; study_days: number; total_mistakes: number; days_since_last: number | null }
  target: number
}

// ── Speaking raw/band helpers (mirrors speaking dashboard) ────────────────
const _SP_BAND: { band: number; raw: [number, number] }[] = [
  { band: 6.0, raw: [52, 55] }, { band: 5.5, raw: [48, 51] },
  { band: 5.0, raw: [43, 47] }, { band: 4.5, raw: [37, 42] },
  { band: 4.0, raw: [32, 36] }, { band: 3.5, raw: [26, 31] },
  { band: 3.0, raw: [21, 25] }, { band: 2.5, raw: [15, 20] },
  { band: 2.0, raw: [10, 14] }, { band: 1.5, raw: [4,   9] },
  { band: 1.0, raw: [0,   3] },
]
function spRawToBand(raw: number): number {
  const r = Math.max(0, Math.min(55, Math.round(raw)))
  for (const row of _SP_BAND) { if (r >= row.raw[0] && r <= row.raw[1]) return row.band }
  return 1.0
}
function spBandColor(band: number): string {
  if (band >= 5.5) return 'var(--green)'
  if (band >= 4.5) return '#2c7873'
  if (band >= 3.5) return 'var(--amber)'
  return 'var(--red)'
}

// ── Icon SVG paths ─────────────────────────────────────────────────────────
const ICONS: Record<string, { bg: string; fg: string; svg: string }> = {
  Speaking: {
    bg: 'var(--speaking-bg)', fg: 'var(--speaking-fg)',
    svg: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8.5 21h7"/>',
  },
  Writing: {
    bg: 'var(--writing-bg)', fg: 'var(--writing-fg)',
    svg: '<path d="M3 21l4-1 11.3-11.3a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L3 16v5Z"/><path d="M14 6l4 4"/>',
  },
  Grammar: {
    bg: 'var(--grammar-bg)', fg: 'var(--grammar-fg)',
    svg: '<path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="2"/>',
  },
}

function iconSvg(key: string, size: number) {
  const i = ICONS[key]
  if (!i) return ''
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${i.fg}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:${size}px;height:${size}px">${i.svg}</svg>`
}

// ── Small chart helper ─────────────────────────────────────────────────────
function useChart(ref: React.RefObject<HTMLCanvasElement | null>, builder: () => Chart | null, deps: unknown[]) {
  useEffect(() => {
    if (!ref.current) return
    const chart = builder()
    return () => { chart?.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// ── Score Trend Chart ──────────────────────────────────────────────────────
function ScoreTrendChart({ data, target }: { data: DashSummary['daily_scores']; target: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useChart(ref, () => {
    if (!ref.current || !data.length) return null
    return new Chart(ref.current, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Daily Avg',
            data: data.map(d => ({ x: d.day as unknown as number, y: d.avg as number })),
            borderColor: 'rgba(44,120,115,0.28)',
            backgroundColor: 'transparent',
            fill: false, tension: 0.2, pointRadius: 2,
            pointBackgroundColor: 'rgba(44,120,115,0.4)',
            borderWidth: 1, spanGaps: false, order: 2,
          },
          {
            label: '7-Day Rolling',
            data: data.map(d => ({ x: d.day as unknown as number, y: d.rolling as number })),
            borderColor: '#2c7873',
            backgroundColor: 'transparent',
            fill: false, tension: 0.4, pointRadius: 0,
            borderWidth: 3, spanGaps: true, order: 1,
          },
          {
            label: `Target (${target}/6)`,
            data: data.length ? [
              { x: data[0].day as unknown as number, y: target },
              { x: data[data.length - 1].day as unknown as number, y: target },
            ] : [],
            borderColor: 'rgba(22,163,74,0.55)',
            backgroundColor: 'transparent',
            fill: false, tension: 0, pointRadius: 0,
            borderWidth: 1.5,
            borderDash: [5, 4],
            spanGaps: true, order: 3,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { labels: { color: '#6b7280', font: { size: 11 }, usePointStyle: true, pointStyleWidth: 8 } },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day', displayFormats: { day: 'MMM d' } },
            ticks: { color: '#9ca3af', maxTicksLimit: 10, font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            min: 1, max: 6.5,
            ticks: { color: '#9ca3af', stepSize: 1 },
            grid: { color: '#f1f2f4' },
          },
        },
      },
    })
  }, [data, target])
  return (
    <div style={{ position: 'relative', height: 280 }}>
      <canvas ref={ref} />
    </div>
  )
}

// ── Grammar Accuracy Chart ─────────────────────────────────────────────────
function GrammarChart({ data }: { data: DashSummary['grammar_perf'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useChart(ref, () => {
    if (!ref.current || !data.length) return null
    return new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: data.map(g => `${g.grammar_type} (n=${g.total_attempts})`),
        datasets: [{
          label: 'Accuracy %',
          data: data.map(g => g.accuracy),
          backgroundColor: data.map(g => g.accuracy >= 80 ? '#e7f7ec' : g.accuracy >= 50 ? '#fef3e2' : '#fdeaea'),
          borderColor: data.map(g => g.accuracy >= 80 ? '#16a34a' : g.accuracy >= 50 ? '#b45309' : '#dc2626'),
          borderWidth: 1.5, borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            min: 0, max: 100,
            ticks: { color: '#9ca3af', callback: (v) => v + '%' },
            grid: { color: '#f1f2f4' },
          },
          y: {
            ticks: { color: '#374151', font: { size: 11 } },
            grid: { display: false },
          },
        },
      },
    })
  }, [data])
  return (
    <div style={{ position: 'relative', height: Math.max(200, data.length * 32 + 40) }}>
      <canvas ref={ref} />
    </div>
  )
}

// ── Mistake Trend Chart ────────────────────────────────────────────────────
function MistakeChart({ data }: { data: DashSummary['mistake_trend'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useChart(ref, () => {
    if (!ref.current || !data.length) return null
    return new Chart(ref.current, {
      type: 'bar',
      data: {
        datasets: [
          {
            label: 'New Mistakes',
            data: data.map(d => ({ x: d.day as unknown as number, y: d.n })),
            backgroundColor: '#fdeaea',
            borderColor: '#dc2626',
            borderWidth: 1.5, borderRadius: 3, order: 2,
          },
          {
            label: 'Cumulative',
            data: data.map(d => ({ x: d.day as unknown as number, y: d.cumulative })),
            type: 'line',
            borderColor: '#2c7873',
            backgroundColor: 'transparent',
            borderWidth: 2.5, pointRadius: 2, pointBackgroundColor: '#2c7873',
            tension: 0.3, order: 1,
            yAxisID: 'y1',
          } as never,
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { labels: { color: '#6b7280', font: { size: 11 }, usePointStyle: true, boxWidth: 8 } },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day', displayFormats: { day: 'MMM d' } },
            ticks: { color: '#9ca3af', maxTicksLimit: 8, font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            type: 'linear', position: 'left', beginAtZero: true,
            title: { display: true, text: 'Per Day', color: '#9ca3af', font: { size: 10 } },
            ticks: { color: '#9ca3af', precision: 0 },
            grid: { color: '#f1f2f4' },
          },
          y1: {
            type: 'linear', position: 'right', beginAtZero: true,
            title: { display: true, text: 'Total', color: '#9ca3af', font: { size: 10 } },
            ticks: { color: '#9ca3af', precision: 0 },
            grid: { display: false },
          },
        },
      },
    })
  }, [data])
  return (
    <div style={{ position: 'relative', height: 280 }}>
      <canvas ref={ref} />
    </div>
  )
}

// ── Main dashboard ─────────────────────────────────────────────────────────
function DashboardContent() {
  const [data, setData] = useState<DashSummary | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.get<DashSummary>('/api/dashboard/summary').then(setData).catch(e => setErr(e.message))
  }, [])

  if (err) return <p style={{ color: '#dc2626', padding: '1.5rem' }}>{err}</p>
  if (!data) return <p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p>

  const { totals, section_kpis, grammar_perf, daily_scores, mistake_trend, task_summary, top_mistakes, target } = data

  const daysSinceText = totals.days_since_last === null ? '—'
    : totals.days_since_last === 0 ? 'Today'
    : `${totals.days_since_last}d ago`

  // Grammar avg accuracy
  let gramWeightedSum = 0, gramTotalN = 0
  grammar_perf.forEach(g => { gramWeightedSum += g.accuracy * g.total_attempts; gramTotalN += g.total_attempts })
  const gramAvgAcc = gramTotalN > 0 ? Math.round(gramWeightedSum / gramTotalN) : null

  return (
    <>
      <Topbar />
      <div className="db-container">

        {/* ── Hero ── */}
        <div className="hero section-gap">
          <div className="hero-main">
            <div className="hero-label">Total Practice</div>
            <div className="hero-value">{totals.total_practices} <span>exercises</span></div>
          </div>
          <div className="hero-divider" />
          <div className="hero-stats">
            <div className="hero-stat"><div className="n">{totals.study_days}</div><div className="l">Study Days</div></div>
            <div className="hero-stat"><div className="n">{totals.total_mistakes}</div><div className="l">Mistakes Logged</div></div>
            <div className="hero-stat"><div className="n">{daysSinceText}</div><div className="l">Last Practice</div></div>
          </div>
        </div>

        {/* ── Skill Cards ── */}
        <div className="section-gap">
          <div className="skills-grid">
            {['Speaking', 'Writing'].map(key => {
              const kpi = section_kpis.find(k => k.skill === key)
              if (!kpi?.attempts) return (
                <div key={key} className="skill-card not-started-card">
                  <div className="skill-card-top">
                    <div className="skill-icon" style={{ background: ICONS[key].bg }}
                      dangerouslySetInnerHTML={{ __html: iconSvg(key, 18) }} />
                  </div>
                  <div className="skill-name">{key}</div>
                  <div className="skill-score" style={{ color: '#9ca3af' }}>—</div>
                  <div className="skill-meta">No sessions yet</div>
                </div>
              )
              const gap = (target - kpi.avg_score).toFixed(1)
              const isGood = parseFloat(gap) <= 0

              // Speaking: show raw/55 + band (mirrors speaking dashboard)
              if (key === 'Speaking') {
                const lr  = data.speaking?.listen_repeat ?? null
                const iv  = data.speaking?.interview ?? null
                const raw = (lr != null || iv != null)
                  ? Math.round((lr ?? 0) * 7 + (iv ?? 0) * 4) : null
                const band = raw != null ? spRawToBand(raw) : null
                const bc   = band != null ? spBandColor(band) : '#9ca3af'
                const targetRaw = 43
                return (
                  <div key={key} className="skill-card">
                    <div className="skill-card-top">
                      <div className="skill-icon" style={{ background: ICONS[key].bg }}
                        dangerouslySetInnerHTML={{ __html: iconSvg(key, 18) }} />
                      <span className="target-pill">Target 5.0 band</span>
                    </div>
                    <div className="skill-name">Speaking</div>
                    <div className="skill-score" style={{ color: bc }}>
                      {raw != null ? raw : '—'}<span className="max"> / 55</span>
                    </div>
                    {band != null && (
                      <div className="skill-gap" style={{ color: bc }}>Band {band.toFixed(1)} / 6.0</div>
                    )}
                    {raw != null && (
                      <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>
                        {raw >= targetRaw ? `↑ ${raw - targetRaw} pts above band 5.0` : `↓ ${targetRaw - raw} pts to band 5.0`}
                      </div>
                    )}
                    <div className="skill-meta">{kpi.attempts} attempts · {kpi.study_days} study days</div>
                  </div>
                )
              }

              return (
                <div key={key} className="skill-card">
                  <div className="skill-card-top">
                    <div className="skill-icon" style={{ background: ICONS[key].bg }}
                      dangerouslySetInnerHTML={{ __html: iconSvg(key, 18) }} />
                    <span className="target-pill">Target {target}/6</span>
                  </div>
                  <div className="skill-name">{key}</div>
                  <div className="skill-score">{kpi.avg_score}<span className="max"> / 6.0</span></div>
                  <div className={`skill-gap ${isGood ? 'good' : 'bad'}`}>
                    {isGood ? `↑ ${Math.abs(parseFloat(gap))} above target` : `↓ ${gap} below target`}
                  </div>
                  <div className="skill-meta">{kpi.attempts} attempts · {kpi.study_days} study days</div>
                </div>
              )
            })}
            {gramTotalN > 0 && (
              <div className="skill-card">
                <div className="skill-card-top">
                  <div className="skill-icon" style={{ background: ICONS.Grammar.bg }}
                    dangerouslySetInnerHTML={{ __html: iconSvg('Grammar', 18) }} />
                  <span className="target-pill">Target 80%</span>
                </div>
                <div className="skill-name">Grammar</div>
                <div className="skill-score">{gramAvgAcc}<span className="max">%</span></div>
                <div className={`skill-gap ${(gramAvgAcc ?? 0) >= 80 ? 'good' : 'bad'}`}>
                  {(gramAvgAcc ?? 0) >= 80 ? 'On target' : `↓ ${80 - (gramAvgAcc ?? 0)} pts below target`}
                </div>
                <div className="skill-meta">{gramTotalN} attempts logged</div>
              </div>
            )}
          </div>
        </div>

        {/* ── Score Trend ── */}
        <div className="section-gap">
          <div className="chart-card full-width">
            <h3>Score Trend — Daily Average</h3>
            <div className="chart-subtitle">7-day rolling average shown in teal · raw daily average shown faintly · target {target}/6</div>
            <ScoreTrendChart data={daily_scores} target={target} />
          </div>
        </div>

        {/* ── Grammar + Mistake charts ── */}
        <div className="charts-grid section-gap">
          <div className="chart-card">
            <h3>Grammar Accuracy by Topic</h3>
            <div className="legend-row">
              <span><span className="dot green" />≥80%</span>
              <span><span className="dot amber" />50–79%</span>
              <span><span className="dot red" />&lt;50%</span>
            </div>
            {grammar_perf.length ? <GrammarChart data={grammar_perf} /> : <p className="empty-note">No grammar data yet.</p>}
          </div>
          <div className="chart-card">
            <h3>Mistakes Over Time</h3>
            <div className="chart-subtitle">New per day (bars) · cumulative total (line)</div>
            {mistake_trend.length ? <MistakeChart data={mistake_trend} /> : <p className="empty-note">No mistakes logged yet.</p>}
          </div>
        </div>

        {/* ── Task Summary ── */}
        <div className="section-gap">
          <div className="table-card full-width">
            <h3>Performance by Task Type</h3>
            <table>
              <thead>
                <tr>
                  <th>Task Type</th>
                  <th className="num">n</th>
                  <th className="num">Avg</th>
                  <th className="num">Range</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {task_summary.map(t => {
                  const badge = t.attempts < 3 ? '' : t.avg_score >= 4.5 ? 'badge-good' : t.avg_score >= 3 ? 'badge-mid' : 'badge-bad'
                  const conf = t.attempts < 3
                    ? <span className="conf"><span className="dot red" />low data</span>
                    : t.attempts < 10
                    ? <span className="conf"><span className="dot amber" />limited (n={t.attempts})</span>
                    : <span className="conf"><span className="dot green" />reliable</span>
                  return (
                    <tr key={t.task_type} className={t.attempts < 3 ? 'low-n' : ''}>
                      <td>{t.task_type}</td>
                      <td className="num">{t.attempts}</td>
                      <td className="num"><span className={`badge ${badge}`}>{t.avg_score}</span></td>
                      <td className="num">{t.min_score} – {t.max_score}</td>
                      <td>{conf}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Top Mistakes ── */}
        <div className="table-card section-gap">
          <h3>Top Recurring Mistakes</h3>
          {top_mistakes.length === 0 ? (
            <p className="empty-note">No mistakes logged yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Grammar Type</th>
                  <th className="num">Occurrences</th>
                  <th className="num">Recurrence</th>
                  <th>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {top_mistakes.map(m => (
                  <tr key={m.grammar_type}>
                    <td>{m.grammar_type}</td>
                    <td className="num">
                      <span className={`badge ${m.count >= 5 ? 'badge-bad' : m.count >= 3 ? 'badge-mid' : 'badge-good'}`}>
                        {m.count}x
                      </span>
                    </td>
                    <td className="num">{m.total_recurrence || 0}x</td>
                    <td>{(m.last_seen || '').substring(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Nav cards ── */}
        <div className="nav-cards-grid section-gap">
          {[
            { href: '/dashboard/writing', label: 'Writing Details' },
            { href: '/dashboard/speaking', label: 'Speaking Details' },
            { href: '/dashboard/grammar', label: 'Grammar Details' },
          ].map(c => (
            <Link key={c.href} href={c.href} className="nav-card">
              {c.label} →
            </Link>
          ))}
        </div>

      </div>
    </>
  )
}

export default function DashboardPage() {
  return <RequireAuth><DashboardContent /></RequireAuth>
}
