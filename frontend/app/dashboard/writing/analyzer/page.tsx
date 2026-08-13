'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'
import { Chart, registerables } from 'chart.js'
import 'chartjs-adapter-date-fns'

Chart.register(...registerables)
Chart.defaults.color = '#6b7280'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalyzerData {
  dimensions: {
    avg_content: number | null
    avg_syntax: number | null
    avg_lexical: number | null
    avg_conventions: number | null
    avg_accuracy: number | null
    total_sessions: number
  }
  session_trend: {
    id: number; date: string; task_type: string; score: number | null
    dimension_content: number | null; dimension_syntax: number | null
    dimension_lexical: number | null; dimension_conventions: number | null
    dimension_accuracy: number | null
  }[]
  weekly_trend: {
    week: string; sessions: number
    content: number | null; syntax: number | null; lexical: number | null
    conventions: number | null; accuracy: number | null
  }[]
  error_types: { grammar_type: string; cnt: number }[]
  latest_by_task: {
    task_type: string
    dimension_content: number | null; dimension_syntax: number | null
    dimension_lexical: number | null; dimension_conventions: number | null
    dimension_accuracy: number | null
  }[]
}

// ── Dimension definitions ─────────────────────────────────────────────────────

const DIMS = [
  { key: 'content',     label: 'Content',      avgKey: 'avg_content',     color: '#6366f1', icon: '🎯',
    desc: 'Prompt relevance, discourse coherence, and idea elaboration' },
  { key: 'syntax',      label: 'Syntax',       avgKey: 'avg_syntax',      color: '#10b981', icon: '🏗️',
    desc: 'Sentence variety and clause complexity' },
  { key: 'lexical',     label: 'Vocabulary',   avgKey: 'avg_lexical',     color: '#f59e0b', icon: '📚',
    desc: 'Vocabulary range, sophistication, and collocation accuracy' },
  { key: 'conventions', label: 'Conventions',  avgKey: 'avg_conventions', color: '#ec4899', icon: '✉️',
    desc: 'Register formality, politeness, hedge/modal use, email structure' },
  { key: 'accuracy',    label: 'Accuracy',     avgKey: 'avg_accuracy',    color: '#0ea5e9', icon: '✅',
    desc: 'Spelling and punctuation correctness' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined) {
  return v != null ? `${Math.round(v * 100)}%` : '—'
}

function dimColor(v: number | null | undefined) {
  if (v == null) return '#9ca3af'
  if (v >= 0.75) return '#16a34a'
  if (v >= 0.55) return '#d97706'
  return '#dc2626'
}

function dimLabel(v: number | null | undefined) {
  if (v == null) return 'No data'
  if (v >= 0.75) return 'Strong'
  if (v >= 0.55) return 'Developing'
  return 'Needs Work'
}

// ── Radar Chart ───────────────────────────────────────────────────────────────

function RadarChart({ dimensions }: { dimensions: AnalyzerData['dimensions'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const vals = DIMS.map(d => {
      const v = dimensions[d.avgKey as keyof typeof dimensions] as number | null
      return v != null ? Math.round(v * 100) : 0
    })
    const chart = new Chart(ref.current, {
      type: 'radar',
      data: {
        labels: DIMS.map(d => d.label),
        datasets: [
          {
            label: 'Your avg',
            data: vals,
            borderColor: '#2a7a7a',
            backgroundColor: 'rgba(42,122,122,0.12)',
            pointBackgroundColor: DIMS.map(d => d.color),
            pointRadius: 5,
            borderWidth: 2,
          },
          {
            label: 'Target (75%)',
            data: [75, 75, 75, 75, 75],
            borderColor: '#e5e7eb',
            backgroundColor: 'transparent',
            pointBackgroundColor: '#e5e7eb',
            pointRadius: 3,
            borderWidth: 1,
            borderDash: [4, 4],
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#6b7280', font: { size: 11 } } } },
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { stepSize: 25, color: '#9ca3af', backdropColor: 'transparent' },
            grid: { color: '#e5e7eb' },
            pointLabels: { color: '#1f2937', font: { size: 12 } },
          },
        },
      },
    })
    return () => chart.destroy()
  }, [dimensions])
  return <div style={{ position: 'relative', height: 280 }}><canvas ref={ref} /></div>
}

// ── Dimension trend line chart ────────────────────────────────────────────────

function TrendChart({
  sessions,
  dimKey,
  color,
}: {
  sessions: AnalyzerData['session_trend']
  dimKey: string
  color: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !sessions.length) return
    const labels = sessions.map(s => s.date.slice(0, 10))
    const data = sessions.map(s => {
      const v = s[`dimension_${dimKey}` as keyof typeof s] as number | null
      return v != null ? Math.round(v * 100) : null
    })
    const chart = new Chart(ref.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data,
            borderColor: color,
            backgroundColor: color + '22',
            fill: true, tension: 0.35, pointRadius: 4,
            pointBackgroundColor: color, borderWidth: 2,
            spanGaps: true,
            label: 'Score',
          },
          {
            data: labels.map(() => 75),
            borderColor: 'rgba(22,163,74,0.45)',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            label: 'Target 75%',
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label === 'Target 75%' ? 'Target: 75%' : `${ctx.parsed.y}%` } },
        },
        scales: {
          y: {
            min: 0, max: 100,
            ticks: { color: '#9ca3af', stepSize: 25, callback: v => `${v}%` },
            grid: { color: '#f1f2f4' },
          },
          x: {
            ticks: { color: '#9ca3af', maxTicksLimit: 6, font: { size: 10 } },
            grid: { display: false },
          },
        },
      },
    })
    return () => chart.destroy()
  }, [sessions, dimKey, color])
  return <div style={{ position: 'relative', height: 160 }}><canvas ref={ref} /></div>
}

// ── Main ──────────────────────────────────────────────────────────────────────

function WritingAnalyzerContent() {
  const router = useRouter()
  const [data, setData] = useState<AnalyzerData | null>(null)
  const [err, setErr] = useState('')
  const [activeDim, setActiveDim] = useState<string | null>(null)

  useEffect(() => {
    api.get<AnalyzerData>('/api/dashboard/writing-analyzer')
      .then(setData)
      .catch(e => setErr(e.message))
  }, [])

  if (err) return <><Topbar /><p style={{ color: '#dc2626', padding: '1.5rem' }}>{err}</p></>
  if (!data) return <><Topbar /><p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p></>

  const { dimensions, session_trend, error_types } = data
  const totalErrors = error_types.reduce((s, e) => s + e.cnt, 0)
  const hasEnoughData = dimensions.total_sessions >= 3

  return (
    <>
      <Topbar />
      <div className="db-container">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <button
            onClick={() => router.push('/dashboard/writing')}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}
          >
            ← Writing Dashboard
          </button>
          <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#1f2937' }}>
            Writing Analyzer
          </h1>
          <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>
            {dimensions.total_sessions} session{dimensions.total_sessions !== 1 ? 's' : ''} analyzed
          </span>
        </div>

        {dimensions.total_sessions === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#6b7280' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📊</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No writing analysis data yet</div>
            <p style={{ fontSize: '0.85rem' }}>Submit an Email or Discussion practice to see your dimension scores here.</p>
            <button onClick={() => router.push('/practice/writing')} style={primaryBtnStyle}>
              Start practicing →
            </button>
          </div>
        ) : (
          <>
            {/* ── Row 1: Radar + Dimension scores ── */}
            <div className="dash-grid-w section-gap">
              <div className="card-w">
                <h2>Overall Profile</h2>
                <RadarChart dimensions={dimensions} />
              </div>

              <div className="card-w">
                <h2>Dimension Averages</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                  {DIMS.map(d => {
                    const v = dimensions[d.avgKey as keyof typeof dimensions] as number | null
                    const color = dimColor(v)
                    const barPct = v != null ? Math.round(v * 100) : 0
                    return (
                      <div key={d.key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.85rem' }}>{d.icon}</span>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1f2937' }}>{d.label}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '0.75rem', color, fontWeight: 600 }}>{dimLabel(v)}</span>
                            <span style={{ fontSize: '0.88rem', fontWeight: 700, color }}>{pct(v)}</span>
                          </div>
                        </div>
                        <div style={{ background: '#f3f4f6', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                          <div style={{
                            width: `${barPct}%`, height: '100%',
                            background: color,
                            borderRadius: 4,
                            transition: 'width 0.5s ease',
                          }} />
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 3 }}>{d.desc}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── Row 2: Dimension trend charts ── */}
            {session_trend.length >= 2 && (
              <div className="section-gap">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1f2937' }}>Dimension Trends</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {DIMS.map(d => (
                      <button
                        key={d.key}
                        onClick={() => setActiveDim(activeDim === d.key ? null : d.key)}
                        style={{
                          padding: '3px 10px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600,
                          cursor: 'pointer', border: `1px solid ${d.color}44`,
                          background: activeDim === d.key ? d.color : d.color + '15',
                          color: activeDim === d.key ? '#fff' : d.color,
                          transition: 'all 0.15s',
                        }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeDim ? (
                  <div className="card-w">
                    {(() => {
                      const d = DIMS.find(x => x.key === activeDim)!
                      return (
                        <>
                          <div style={{ marginBottom: 8 }}>
                            <span style={{ fontWeight: 600, color: d.color }}>{d.icon} {d.label}</span>
                            <span style={{ fontSize: '0.78rem', color: '#6b7280', marginLeft: 8 }}>{d.desc}</span>
                          </div>
                          <TrendChart sessions={session_trend} dimKey={d.key} color={d.color} />
                        </>
                      )
                    })()}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                    {DIMS.map(d => (
                      <div key={d.key} className="card-w" style={{ padding: '1rem 1.2rem' }}>
                        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: '0.85rem' }}>{d.icon}</span>
                          <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1f2937' }}>{d.label}</span>
                          <span style={{
                            marginLeft: 'auto', fontSize: '0.78rem', fontWeight: 700,
                            color: dimColor(dimensions[d.avgKey as keyof typeof dimensions] as number | null),
                          }}>
                            {pct(dimensions[d.avgKey as keyof typeof dimensions] as number | null)} avg
                          </span>
                        </div>
                        <TrendChart sessions={session_trend} dimKey={d.key} color={d.color} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Row 3: Priority focus + Error types ── */}
            <div className="dash-grid-w section-gap">

              {/* Priority focus */}
              <div className="card-w">
                <h2>Priority Focus</h2>
                {(() => {
                  const sorted = DIMS
                    .map(d => ({ ...d, v: dimensions[d.avgKey as keyof typeof dimensions] as number | null }))
                    .filter(d => d.v != null)
                    .sort((a, b) => (a.v ?? 1) - (b.v ?? 1))

                  if (sorted.length === 0) return <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No data yet.</p>

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {sorted.map((d, i) => {
                        const isWeakest = i === 0
                        const gap = d.v != null ? Math.max(0, 75 - Math.round(d.v * 100)) : null
                        return (
                          <div key={d.key} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 14px', borderRadius: 10,
                            background: isWeakest ? '#fff8f7' : '#fafafa',
                            border: `1px solid ${isWeakest ? '#fecaca' : '#e5e7eb'}`,
                          }}>
                            <span style={{ fontSize: '1.1rem' }}>{d.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1f2937' }}>{d.label}</span>
                                {isWeakest && (
                                  <span style={{ fontSize: '0.65rem', fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase' }}>
                                    Focus here
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>{d.desc}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: '1rem', fontWeight: 800, color: dimColor(d.v) }}>{pct(d.v)}</div>
                              {gap !== null && gap > 0 && (
                                <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>−{gap}% to target</div>
                              )}
                              {gap === 0 && (
                                <div style={{ fontSize: '0.7rem', color: '#16a34a' }}>✓ On target</div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>

              {/* Error types */}
              <div className="card-w">
                <h2>Common Grammar Errors</h2>
                {error_types.length === 0 ? (
                  <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No writing grammar mistakes logged yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {error_types.map((e, i) => {
                      const pctVal = totalErrors > 0 ? Math.round((e.cnt / totalErrors) * 100) : 0
                      const barColor = pctVal >= 30 ? '#dc2626' : pctVal >= 15 ? '#d97706' : '#2a7a7a'
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                              <span style={{ fontSize: '0.82rem', color: '#374151', fontWeight: 500 }}>{e.grammar_type}</span>
                              <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{e.cnt}×</span>
                            </div>
                            <div style={{ background: '#f3f4f6', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                              <div style={{ width: `${pctVal}%`, height: '100%', background: barColor, borderRadius: 4 }} />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Low data notice */}
            {!hasEnoughData && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
                padding: '12px 16px', fontSize: '0.82rem', color: '#92400e', marginBottom: '1.5rem',
              }}>
                📊 Only {dimensions.total_sessions} session{dimensions.total_sessions !== 1 ? 's' : ''} analyzed so far.
                Scores will stabilize after 5+ sessions. Keep practicing!
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '2rem' }}>
              <button onClick={() => router.push('/practice/writing/email')} style={primaryBtnStyle}>
                Practice Email →
              </button>
              <button onClick={() => router.push('/practice/writing/discussion')} style={ghostBtnStyle}>
                Practice Discussion →
              </button>
              <button onClick={() => router.push('/dashboard/writing')} style={ghostBtnStyle}>
                Writing Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  background: '#2a7a7a', color: '#fff',
  border: 'none', borderRadius: 8, padding: '0.55rem 1.2rem',
  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
}

const ghostBtnStyle: React.CSSProperties = {
  background: '#fff', color: '#374151',
  border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.55rem 1.2rem',
  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
}

export default function WritingAnalyzerPage() {
  return <RequireAuth><WritingAnalyzerContent /></RequireAuth>
}
