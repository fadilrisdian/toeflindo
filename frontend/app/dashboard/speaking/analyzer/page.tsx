'use client'

import { AnnotatedTranscript } from '@/components/CorrectionPopover'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api, apiFetch } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'
import { Chart, registerables } from 'chart.js'
import 'chartjs-adapter-date-fns'

Chart.register(...registerables)
Chart.defaults.color = '#6b7280'

// ── Types ───────────────────────────────────────────────────────────────────
interface AnalyzerData {
  dimensions: { pronunciation: number|null; fluency: number|null; grammar: number|null; vocabulary: number|null; intonation: number|null; discourse: number|null }
  overall: number
  data_source: string
  weekly_trend: { week: string; pronunciation: number|null; fluency: number|null; grammar: number|null; vocabulary: number|null; intonation: number|null; discourse: number|null; overall_score: number|null }[]
  pron_history: { date: string; score: number|null; confidence: number|null; transcript: string }[]
  all_mistakes: { grammar_type: string; wrong: string; correct: string; explanation: string; recurrence_count: number }[]
  top_mistake_types: { grammar_type: string; count: number; total_rec: number }[]
  recommendations: { mistake: string; unit: string; topic: string; count: number }[]
  totals: { lr_sessions: number; iv_sessions: number; total_mistakes: number; analyzer_sessions: number; avg_task_raw: number|null; avg_estimated_band: number|null }
}

interface HistorySession {
  id: number; date: string; audio_filename: string|null; transcript: string|null; task_type: string|null; topic: string|null
  overall_score: number|null; pronunciation_score: number|null; fluency_score: number|null
  grammar_score: number|null; vocabulary_score: number|null; intonation_score: number|null
  discourse_score: number|null; wpm: number|null; cefr_level: string|null
  task_raw_score: number|null; estimated_band: number|null
}

interface AnalyzeResult {
  overall: number; transcript: string; duration_seconds: number; processing_time_seconds: number
  pronunciation: { score: number; feedback: string[]; low_confidence_words: {word:string;confidence:number}[]; avg_word_confidence: number|null }
  fluency: { score: number; feedback: string[]; wpm: number; pause_count: number; long_pause_count: number; filler_count: number; filler_instances: {word:string}[]; pauses: {long:boolean;duration:number;after_word:string}[] }
  grammar: { score: number; feedback: string[]; corrections: {original:string;correct:string;explanation:string}[]; grammatical_range?: {score:number;conjunctions_used:string[];has_complex_sentence:boolean;has_conditional:boolean;range_tip:string} }
  vocabulary: { score: number; feedback: string[]; cefr_level: string; suggestions: {word:string;replacement:string;reason:string}[]; repeated_words: string[]; synonym_suggestions?: {overused_word:string;synonyms:string[]}[]; vocabulary_diversity?: {score:number;type_token_ratio:number;diversity_tip:string} }
  intonation: { score: number; feedback: string[]; pitch_stats: {std_hz?:number}; energy_variation: number|null; tempo_bpm: number|null }
  discourse: { score: number; coherence_score: number; marker_score: number; feedback: string[]; has_structure: boolean; has_example: boolean; coherence_tip: string; marker_tip: string; markers_found: string[]; marker_count: number }
  session_id?: number
}

const DIM_DEFS = [
  { key: 'pronunciation', label: 'Pronunciation', icon: '🎙', color: '#6366f1', subtitle: 'Accuracy of sounds and word repetition' },
  { key: 'fluency',       label: 'Fluency',       icon: '🌊', color: '#10b981', subtitle: 'Smoothness and continuity of speech' },
  { key: 'grammar',       label: 'Grammar',       icon: '📝', color: '#f59e0b', subtitle: 'Accuracy and range of grammatical structures' },
  { key: 'vocabulary',    label: 'Vocabulary',    icon: '📚', color: '#ec4899', subtitle: 'Range, precision, and diversity of word choice' },
  { key: 'intonation',    label: 'Intonation',    icon: '🎵', color: '#8b5cf6', subtitle: 'Stress patterns and natural rhythm' },
  { key: 'discourse',     label: 'Discourse',     icon: '🗂',  color: '#0ea5e9', subtitle: 'Coherence, structure, and discourse markers' },
]

function getLevelText(v: number) { return v >= 4.5 ? 'Strong' : v >= 3.5 ? 'Proficient' : v >= 2.5 ? 'Developing' : 'Needs Work' }
function getLevelColor(v: number) { return v >= 4.5 ? '#10b981' : v >= 3.0 ? '#f59e0b' : '#ef4444' }
function badgeClass(s: number) { return s >= 4.5 ? 'badge-good' : s >= 3 ? 'badge-mid' : 'badge-bad' }


// ── Radar Chart ──────────────────────────────────────────────────────────────
function RadarChart({ dims }: { dims: AnalyzerData['dimensions'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const vals = DIM_DEFS.map(d => (dims[d.key as keyof typeof dims] ?? 1) as number)
    const chart = new Chart(ref.current, {
      type: 'radar',
      data: {
        labels: DIM_DEFS.map(d => d.label),
        datasets: [
          { label: 'Your Score', data: vals, borderColor: '#2c7873', backgroundColor: 'rgba(44,120,115,0.12)', pointBackgroundColor: DIM_DEFS.map(d => d.color), pointRadius: 5, borderWidth: 2 },
          { label: 'Target (5.0)', data: [5,5,5,5,5], borderColor: '#e6e8eb', backgroundColor: 'transparent', pointBackgroundColor: '#e6e8eb', pointRadius: 3, borderWidth: 1, borderDash: [4,4] },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#6b7280', font: { size: 11 } } } },
        scales: { r: { min: 1, max: 6, ticks: { stepSize: 1, color: '#9ca3af', backdropColor: 'transparent' }, grid: { color: '#e6e8eb' }, pointLabels: { color: '#1f2937', font: { size: 12 } } } },
      },
    })
    return () => chart.destroy()
  }, [dims])
  return <div style={{ position: 'relative', height: 280 }}><canvas ref={ref} /></div>
}

// ── Trend Chart ───────────────────────────────────────────────────────────────
function TrendChart({ trend }: { trend: AnalyzerData['weekly_trend'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !trend.length) return
    const chart = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: trend.map(w => w.week),
        datasets: DIM_DEFS.map(d => ({
          label: d.label,
          data: trend.map(w => w[d.key as keyof typeof w] as number),
          borderColor: d.color, backgroundColor: 'transparent',
          tension: 0.4, pointRadius: 3, borderWidth: 2, spanGaps: true,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#6b7280', font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#9ca3af', maxTicksLimit: 8 }, grid: { display: false } },
          y: { min: 1, max: 6, ticks: { color: '#9ca3af', stepSize: 1 }, grid: { color: '#f1f2f4' } },
        },
      },
    })
    return () => chart.destroy()
  }, [trend])
  return <div style={{ position: 'relative', height: 280 }}><canvas ref={ref} /></div>
}

// ── Mistake Bar Chart ─────────────────────────────────────────────────────────
function MistakeChart({ data }: { data: AnalyzerData['top_mistake_types'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const PAL = ['#6366f1','#ec4899','#f59e0b','#10b981','#8b5cf6','#06b6d4','#f43f5e','#84cc16','#fb923c','#a78bfa','#34d399','#f87171']
  useEffect(() => {
    if (!ref.current || !data.length) return
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: data.map(m => m.grammar_type.length > 24 ? m.grammar_type.substring(0, 24) + '…' : m.grammar_type),
        datasets: [{ label: 'Occurrences', data: data.map(m => m.count), backgroundColor: data.map((_, i) => PAL[i % 12]), borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y' as const, responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { min: 0, ticks: { color: '#9ca3af', stepSize: 1 }, grid: { color: '#f1f2f4' } },
          y: { ticks: { color: '#374151', font: { size: 11 } }, grid: { display: false } },
        },
      },
    })
    return () => chart.destroy()
  }, [data])
  return <div style={{ position: 'relative', height: Math.max(160, data.length * 28 + 40) }}><canvas ref={ref} /></div>
}

// ── Pronunciation History Chart ────────────────────────────────────────────────
function PronChart({ history }: { history: AnalyzerData['pron_history'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !history.length) return
    const scores = history.map(p => p.score)
    const chart = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: history.map(p => p.date),
        datasets: [{ label: 'Pronunciation (1-6)', data: scores, borderColor: '#2c7873', backgroundColor: 'rgba(44,120,115,0.07)', fill: true, tension: 0.3, pointRadius: 5, pointBackgroundColor: scores.map(s => s && s >= 4 ? '#16a34a' : s && s >= 2.5 ? '#b45309' : '#dc2626') }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#6b7280', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#9ca3af', maxTicksLimit: 8 }, grid: { display: false } },
          y: { min: 1, max: 6.5, ticks: { color: '#9ca3af' }, grid: { color: '#f1f2f4' } },
        },
      },
    })
    return () => chart.destroy()
  }, [history])
  return <div style={{ position: 'relative', height: 200 }}><canvas ref={ref} /></div>
}


// ── Upload + Live Analysis Section ───────────────────────────────────────────
function UploadAnalyzer({ onNewResult }: { onNewResult: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  function handleFile(f: File) {
    setFile(f)
    setResult(null)
    setError('')
  }

  async function startAnalysis() {
    if (!file) return
    setAnalyzing(true)
    setError('')
    setResult(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const data = await apiFetch<AnalyzeResult>('/api/speaking/upload-analyze', { method: 'POST', body: fd })
      setResult(data)
      onNewResult()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const node = el
    function onDragOver(e: DragEvent) { e.preventDefault(); node.classList.add('drag-over') }
    function onDragLeave() { node.classList.remove('drag-over') }
    function onDrop(e: DragEvent) { e.preventDefault(); node.classList.remove('drag-over'); const f = e.dataTransfer?.files[0]; if (f) handleFile(f) }
    node.addEventListener('dragover', onDragOver)
    node.addEventListener('dragleave', onDragLeave)
    node.addEventListener('drop', onDrop)
    return () => { node.removeEventListener('dragover', onDragOver); node.removeEventListener('dragleave', onDragLeave); node.removeEventListener('drop', onDrop) }
  }, [])

  return (
    <div>
      <div ref={dropRef} className="upload-card" onClick={() => !file && inputRef.current?.click()}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.4rem', color: 'var(--text)' }}>Upload Audio File</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-mut)', marginBottom: '1.2rem' }}>Supports MP3, WAV, M4A, OGG, WebM — max 50MB. Drag & drop or click.</p>
        <input ref={inputRef} type="file" accept=".mp3,.wav,.m4a,.ogg,.webm,.flac" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
        {file
          ? <div style={{ fontSize: '0.85rem', color: 'var(--teal-700)', fontWeight: 600 }}>📎 {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</div>
          : <button className="upload-btn" type="button">Choose File</button>
        }
      </div>

      {file && !analyzing && !result && (
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <button onClick={startAnalysis} className="upload-btn" style={{ fontSize: '0.9rem', padding: '0.7rem 2rem' }}>
            🎙 Analyze Speech
          </button>
          <button onClick={() => { setFile(null); inputRef.current && (inputRef.current.value = '') }} style={{ marginLeft: '1rem', fontSize: '0.82rem', color: 'var(--text-mut)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      )}

      {analyzing && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-mut)', fontSize: '0.88rem' }}>
          <div style={{ marginBottom: '0.8rem', fontSize: '1.5rem' }}>⏳</div>
          Analyzing speech — this takes 10–20 seconds…
          <div style={{ height: 6, background: '#f1f2f4', borderRadius: 4, margin: '1rem auto', maxWidth: 320, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--teal-700)', borderRadius: 4, animation: 'progress-pulse 1.5s ease-in-out infinite', width: '100%' }} />
          </div>
        </div>
      )}

      {error && <div style={{ background: '#fdeaea', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem', color: '#dc2626', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</div>}

      {result && <AnalysisResult result={result} />}
    </div>
  )
}

// ── Analysis Result Display ───────────────────────────────────────────────────
function AnalysisResult({ result }: { result: AnalyzeResult }) {
  const pct = Math.round(((result.overall - 1) / 5) * 100)
  return (
    <div style={{ marginTop: '1.5rem' }}>
      {/* Overall */}
      <div className="result-overall">
        <div className="result-score-circle" style={{ ['--pct' as string]: pct + '%' }}>
          <span>{result.overall}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.3rem' }}>Overall Speaking Score</div>
          <div style={{ fontSize: '0.88rem', color: 'var(--text-mut)', fontStyle: 'italic', lineHeight: 1.5 }}>
            <AnnotatedTranscript
              text={result.transcript}
              corrections={(result.grammar?.corrections ?? []).map(c => ({
                original: c.original,
                correct: c.correct,
                explanation: c.explanation,
              }))}
            />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-fnt)', marginTop: '0.3rem' }}>
            Duration: {result.duration_seconds}s · Processed in: {result.processing_time_seconds}s
          </div>
        </div>
      </div>

      {/* Dimension cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: '1rem', margin: '1.5rem 0' }}>
        {DIM_DEFS.map(def => {
          const dim = result[def.key as keyof AnalyzeResult] as { score: number; feedback: string[]; wpm?: number; pause_count?: number; filler_count?: number; avg_word_confidence?: number; cefr_level?: string; pitch_stats?: {std_hz?: number}; marker_count?: number; has_structure?: boolean; coherence_tip?: string; marker_tip?: string; grammatical_range?: {range_tip:string}; vocabulary_diversity?: {diversity_tip:string} }
          const score = dim?.score ?? 1
          const barPct = Math.max(0, Math.min(100, ((score - 1) / 5) * 100))
          let detail = ''
          if (def.key === 'fluency')     detail = `WPM: ${dim.wpm ?? '—'} · Pauses: ${dim.pause_count ?? '—'} · Fillers: ${dim.filler_count ?? '—'}`
          if (def.key === 'pronunciation') detail = `Avg confidence: ${dim.avg_word_confidence ?? '—'}`
          if (def.key === 'vocabulary')  detail = `CEFR: ${dim.cefr_level}`
          if (def.key === 'intonation' && dim.pitch_stats?.std_hz) detail = `Pitch std: ${dim.pitch_stats.std_hz} Hz`
          if (def.key === 'discourse')   detail = `Markers: ${dim.marker_count ?? 0} · Structure: ${dim.has_structure ? '✓' : '✗'}`
          const tip = def.key === 'grammar'    ? dim.grammatical_range?.range_tip
                    : def.key === 'vocabulary' ? dim.vocabulary_diversity?.diversity_tip
                    : def.key === 'discourse'  ? (dim.coherence_tip || dim.marker_tip)
                    : undefined
          return (
            <div key={def.key} className="result-dim-card" style={{ ['--dc' as string]: def.color }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>{def.icon} {def.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 700, color: def.color }}>{score}</span>
                  <span style={{ fontSize: '0.7rem', color: getLevelColor(score), fontWeight: 600 }}>{getLevelText(score)}</span>
                </div>
              </div>
              <div style={{ background: '#f1f2f4', borderRadius: 3, height: 5, marginBottom: '0.7rem', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: def.color, borderRadius: 3, width: barPct + '%' }} />
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-mut)', lineHeight: 1.5 }}>{(dim.feedback ?? []).join(' ')}</div>
              {detail && <div style={{ fontSize: '0.73rem', color: 'var(--text-fnt)', marginTop: '0.4rem' }}>{detail}</div>}
              {tip    && <div style={{ fontSize: '0.73rem', color: 'var(--teal-700)', marginTop: '0.3rem', fontStyle: 'italic' }}>💡 {tip}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ── History Table ─────────────────────────────────────────────────────────────
function HistoryTable({ sessions, onRowClick, filter }: { sessions: HistorySession[]; onRowClick: (s: HistorySession) => void; filter?: string }) {
  if (!sessions.length) {
    const msg = !filter || filter === 'all'
      ? 'No analysis sessions yet — upload an audio file above.'
      : `No ${filter === 'Listen and Repeat' ? 'Listen & Repeat' : 'Interview'} sessions in history yet.`
    return <p className="empty-note">{msg}</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Transcript</th>
            <th className="num">Raw (0-5)</th><th className="num">Band</th>
            <th className="num">Pron</th><th className="num">Fluency</th>
            <th className="num">Grammar</th><th className="num">Vocab</th>
            <th className="num">Inton</th><th className="num">Disc</th><th className="num">WPM</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(s => (
            <tr key={s.id} className="clickable-row" onClick={() => onRowClick(s)}>
              <td style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{(s.date ?? '').slice(0, 16).replace('T', ' ')}</td>
              <td style={{ maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#9ca3af', fontSize: '0.78rem' }}>{s.transcript ?? '—'}</td>
              <td className="num">{s.task_raw_score != null ? <span className={`badge ${badgeClass(s.task_raw_score / 5 * 6)}`}>{s.task_raw_score}</span> : '—'}</td>
              <td className="num">{s.estimated_band != null ? <span className={`badge ${badgeClass(s.estimated_band)}`}>{s.estimated_band}</span> : '—'}</td>
              {[s.pronunciation_score, s.fluency_score, s.grammar_score, s.vocabulary_score, s.intonation_score, s.discourse_score].map((v, i) => (
                <td key={i} className="num">{v != null ? <span className={`badge ${badgeClass(v)}`}>{v}</span> : '—'}</td>
              ))}
              <td className="num" style={{ color: '#6b7280', fontSize: '0.78rem' }}>{s.wpm ? Math.round(s.wpm) + ' wpm' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const HISTORY_PAGE_SIZE = 10

// ── Main page component ───────────────────────────────────────────────────────
function AnalyzerContent() {
  const [data, setData] = useState<AnalyzerData | null>(null)
  const [history, setHistory] = useState<HistorySession[]>([])
  const [historyFilter, setHistoryFilter] = useState<'all' | 'Listen and Repeat' | 'Take an Interview'>('all')
  const [historyPage, setHistoryPage] = useState(1)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState<HistorySession | null>(null)

  const loadHistory = useCallback(() => {
    api.get<{ sessions: HistorySession[] }>('/api/speaking/analyzer/history?limit=200')
      .then(d => setHistory(d.sessions))
      .catch(() => {})
  }, [])

  useEffect(() => {
    api.get<AnalyzerData>('/api/speaking/analyzer-data').then(setData).catch(e => setErr(e.message))
    loadHistory()
  }, [])

  if (err) return <p style={{ color: '#dc2626', padding: '1.5rem' }}>{err}</p>
  if (!data) return <><Topbar /><p style={{ color: '#6b7280', padding: '1.5rem' }}>Loading…</p></>

  const { dimensions, overall, data_source, weekly_trend, pron_history, top_mistake_types, recommendations, totals } = data
  const pct = Math.round(((overall - 1) / 5) * 100)

  const filteredHistory = historyFilter === 'all'
    ? history
    : history.filter(s => s.task_type === historyFilter)

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE))
  const pagedHistory = filteredHistory.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE)

  return (
    <>
      <Topbar />
      <div className="db-container">

        {/* ── Overall score circle + stats ── */}
        <div className="chart-card section-gap" style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
          <div className="overall-score-circle" style={{ ['--pct' as string]: pct + '%' }}>
            <span style={{ position: 'relative', zIndex: 1, fontSize: '1.5rem', fontWeight: 700, color: 'var(--teal-700)' }}>{overall}</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.3rem' }}>Overall Speaking Score</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-mut)', marginBottom: '0.5rem' }}>Average across all 5 dimensions (1–6 scale)</div>
            <span style={{ display: 'inline-block', padding: '0.25rem 0.8rem', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, background: overall >= 5 ? '#e7f7ec' : overall >= 4 ? '#e6f4ea' : overall >= 3 ? '#fef3e2' : '#fdeaea', color: overall >= 5 ? '#16a34a' : overall >= 4 ? '#2e7d32' : overall >= 3 ? '#b45309' : '#dc2626' }}>
              {overall >= 5 ? 'Advanced' : overall >= 4 ? 'Upper-Intermediate' : overall >= 3 ? 'Intermediate' : 'Beginner'}
            </span>
            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: 20, background: data_source === 'speech_analysis_log' ? '#e7f7ec' : '#f1f2f4', color: data_source === 'speech_analysis_log' ? '#16a34a' : '#6b7280' }}>
              {data_source === 'speech_analysis_log' ? '✓ Real AI scores' : '~ Estimated'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            {[
              ['L&R Sessions', totals.lr_sessions],
              ['Interview Sessions', totals.iv_sessions],
              ['Mistakes', totals.total_mistakes],
              ['Analyzer Sessions', totals.analyzer_sessions],
              ...(totals.avg_task_raw != null ? [['Avg Raw (0-5)', totals.avg_task_raw]] : []),
              ...(totals.avg_estimated_band != null ? [['Avg Band', totals.avg_estimated_band]] : []),
            ].map(([label, val]) => (
              <div key={String(label)} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)' }}>{val}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-fnt)', textTransform: 'uppercase', marginTop: '0.2rem' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Dimension cards ── */}
        <div className="section-title" style={{ marginTop: '1.5rem' }}>5-Dimension Analysis</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem', marginBottom: '2rem' }}>
          {DIM_DEFS.map(def => {
            const val = (dimensions[def.key as keyof typeof dimensions] ?? 1) as number
            const barPct = Math.max(0, Math.min(100, ((val - 1) / 5) * 100))
            return (
              <div key={def.key} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.4rem', borderTop: `3px solid ${def.color}`, boxShadow: 'var(--shadow)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>{def.icon} {def.label}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-mut)', marginTop: '0.1rem' }}>{def.subtitle}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '0.8rem' }}>
                  <span style={{ fontSize: '2.4rem', fontWeight: 700, color: def.color, lineHeight: 1 }}>{val}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-fnt)', marginBottom: '0.3rem' }}>/ 6.0</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: 20, background: val >= 4.5 ? '#e7f7ec' : val >= 3.5 ? '#e6f4ea' : val >= 2.5 ? '#fef3e2' : '#fdeaea', color: val >= 4.5 ? '#16a34a' : val >= 3.5 ? '#2e7d32' : val >= 2.5 ? '#b45309' : '#dc2626' }}>
                    {getLevelText(val)}
                  </span>
                </div>
                <div style={{ background: '#f1f2f4', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: '0.5rem' }}>
                  <div style={{ height: '100%', borderRadius: 4, background: def.color, width: barPct + '%', transition: 'width 0.8s ease' }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Charts row ── */}
        <div className="charts-grid section-gap">
          <div className="chart-card">
            <h3>Dimension Radar</h3>
            <RadarChart dims={dimensions} />
          </div>
          <div className="chart-card">
            <h3>Dimension Trend Over Time</h3>
            {weekly_trend.length > 0 ? <TrendChart trend={weekly_trend} /> : <p className="empty-note">No trend data yet.</p>}
          </div>
        </div>

        <div className="charts-grid section-gap">
          <div className="chart-card">
            <h3>Pronunciation History</h3>
            {pron_history.length > 0 ? <PronChart history={pron_history} /> : <p className="empty-note">No pronunciation history yet.</p>}
          </div>
          <div className="chart-card">
            <h3>Top Speaking Mistakes</h3>
            {top_mistake_types.length > 0 ? <MistakeChart data={top_mistake_types} /> : <p className="empty-note">No mistakes logged yet.</p>}
          </div>
        </div>

        {/* ── Murphy Recommendations ── */}
        {recommendations.length > 0 && (
          <>
            <div className="section-title">Murphy Recommendations</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: '1rem', marginBottom: '2rem' }}>
              {recommendations.map((r, i) => (
                <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '1.2rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', boxShadow: 'var(--shadow)' }}>
                  <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, background: r.count >= 3 ? '#fdeaea' : r.count >= 2 ? '#fef3e2' : '#e7f7ec', color: r.count >= 3 ? '#dc2626' : r.count >= 2 ? '#b45309' : '#16a34a', border: '1px solid' }}>
                    {r.count}x
                  </div>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.2rem' }}>{r.mistake}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--teal-700)', fontWeight: 600, marginBottom: '0.15rem' }}>📖 {r.unit}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-mut)' }}>{r.topic}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Analysis History ── */}
        <div className="section-title">Analysis History</div>
        <div className="table-card section-gap">
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {(['all', 'Listen and Repeat', 'Take an Interview'] as const).map(f => (
              <button
                key={f}
                onClick={() => { setHistoryFilter(f); setHistoryPage(1) }}
                style={{
                  padding: '0.3rem 0.9rem', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                  cursor: 'pointer', border: '1.5px solid',
                  background: historyFilter === f ? 'var(--teal-700)' : 'var(--card)',
                  color: historyFilter === f ? '#fff' : 'var(--text-mut)',
                  borderColor: historyFilter === f ? 'var(--teal-700)' : 'var(--border)',
                  transition: 'all 0.15s',
                }}
              >
                {f === 'all' ? 'All' : f === 'Listen and Repeat' ? '🔁 Listen & Repeat' : '🎤 Interview'}
              </button>
            ))}
          </div>
          <HistoryTable sessions={pagedHistory} onRowClick={setModal} filter={historyFilter} />

          {/* pagination controls */}
          {filteredHistory.length > HISTORY_PAGE_SIZE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                disabled={historyPage === 1}
                style={{ padding: '0.3rem 0.85rem', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, border: '1.5px solid var(--border)', background: 'var(--card)', color: historyPage === 1 ? 'var(--text-fnt)' : 'var(--teal-700)', cursor: historyPage === 1 ? 'default' : 'pointer', opacity: historyPage === 1 ? 0.45 : 1 }}
              >← Prev</button>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-mut)', fontWeight: 600 }}>
                Page {historyPage} of {totalHistoryPages}
              </span>
              <button
                onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))}
                disabled={historyPage === totalHistoryPages}
                style={{ padding: '0.3rem 0.85rem', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, border: '1.5px solid var(--border)', background: 'var(--card)', color: historyPage === totalHistoryPages ? 'var(--text-fnt)' : 'var(--teal-700)', cursor: historyPage === totalHistoryPages ? 'default' : 'pointer', opacity: historyPage === totalHistoryPages ? 0.45 : 1 }}
              >Next →</button>
            </div>
          )}
        </div>

        {/* ── Live Upload Analyzer ── */}
        <div className="section-title" style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '2px solid var(--teal-700)' }}>🎙 Live Speech Analyzer</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-mut)', marginBottom: '1.5rem' }}>Upload an audio recording to get instant 5-dimension AI feedback.</p>
        <div className="chart-card section-gap">
          <UploadAnalyzer onNewResult={loadHistory} />
        </div>

        {/* ── Bottom nav ── */}
        <div className="nav-cards-grid section-gap">
          <Link href="/dashboard/speaking" className="nav-card">← Speaking Dashboard</Link>
          <Link href="/dashboard" className="nav-card">← Overview</Link>
          <Link href="/practice/speaking" className="nav-card">Practice Speaking →</Link>
        </div>
      </div>

      {/* ── Session Modal ── */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)}>×</button>
            <div style={{ display: 'flex', gap: '0.7rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{(modal.date ?? '').slice(0, 16).replace('T', ' ')}</span>
              {modal.task_type && <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{modal.task_type}</span>}
              {modal.task_raw_score != null && <span className={`badge ${badgeClass(modal.task_raw_score / 5 * 6)}`}>Raw: {modal.task_raw_score}/5</span>}
              {modal.estimated_band != null && <span className={`badge ${badgeClass(modal.estimated_band)}`}>Band: {modal.estimated_band}</span>}
              {modal.overall_score != null && <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>acoustic: {modal.overall_score}</span>}
              {modal.cefr_level && <span style={{ fontSize: '0.78rem', color: '#2c7873', fontWeight: 600 }}>CEFR: {modal.cefr_level}</span>}
            </div>
            {modal.transcript && (
              <>
                <div className="modal-label">Transcript</div>
                <div className="modal-text" style={{ marginBottom: '1rem' }}>{modal.transcript}</div>
              </>
            )}
            <div className="modal-label">Dimension Scores</div>
            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {DIM_DEFS.map(d => {
                const val = modal[`${d.key}_score` as keyof HistorySession] as number | null
                return (
                  <div key={d.key} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-fnt)', marginBottom: '0.2rem' }}>{d.label}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: d.color }}>{val ?? '—'}</div>
                  </div>
                )
              })}
              {modal.wpm != null && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-fnt)', marginBottom: '0.2rem' }}>WPM</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{Math.round(modal.wpm)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function AnalyzerPage() {
  return <RequireAuth><AnalyzerContent /></RequireAuth>
}
