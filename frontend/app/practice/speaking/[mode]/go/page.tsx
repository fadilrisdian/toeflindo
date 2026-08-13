'use client'

import { use, useEffect, useRef, useState, Fragment } from 'react'
import { useSearchParams, useRouter as useNextRouter } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'

interface Task { task_id: number; question: string; audio_file?: string; task_type: string }
interface TasksResp { rows: Task[] }
interface AnalyzeResult {
  rubric_score: number
  rubric_rationale: string
  transcript: string
  recording_filename: string | null
  pronunciation_score: number
  fluency_score: number
  grammar_score: number
  vocabulary_score: number
  intonation_score: number
  discourse_score: number
  wpm: number | null
  filler_count: number
  pause_count: number
  marker_count: number
  markers_found: string[]
  has_structure: boolean
  has_example: boolean
  coherence_tip: string
  marker_tip: string
  // Official scoring fields
  task_raw_score: number
  estimated_band: number
  scoring_mode: string
  ets_dimensions: Record<string, number>
  llm_dimension_scores?: Record<string, number>
  // Readiness fields
  readiness_score?: number
  readiness_level?: string
  strengths?: Array<{ strength: string; evidence: string }>
  priority_issues?: Array<{ issue: string; evidence: string; priority: string }>
  prompt_version?: string
  status: string
  message?: string
  _error?: string
}

type Mode = 'listen-and-repeat' | 'interview'
const TASK_TYPE_MAP: Record<string, string> = {
  'listen-and-repeat': 'Listen and Repeat',
  'interview':         'Take an Interview',
}

const LNR_CHECKLIST = [
  'Did I add or miss any words?',
  'Did I utter the correct form of every word (for example "belonged" should be "belongs")?',
  "Did I avoid vocal fillers like 'uh' or 'um'?",
  'Did I hesitate or repeat words?',
  'Did I repeat the sentence in 10 seconds or less?',
  'Did I bring words together and speak smoothly?',
  'Did I clearly and correctly pronounce all the words?',
]

const IV_CHECKLIST = [
  'Did I include less than three fillers (uh, um, you know)?',
  'Did I stay on topic and answer the question?',
  'Did I avoid hesitating or repeating more than two separate times?',
  'Did I speak for at least 42 seconds?',
  'Did I use at least two transitional words or phrases?',
  'Did I elaborate on the topic with a well-developed personal example, anecdote, or explanation?',
  'Did I provide a response at least 110 words long?',
  'Did I include at least one strong phrase, idiom, or expression?',
  'Did I speak at a natural pace, not too fast or slow?',
  'Did I speak clearly enough to be easily understood? (check with speech-to-text software)',
]

function pad2(n: number) { return n.toString().padStart(2, '0') }
function fmtTimer(s: number, isLnR: boolean) {
  if (isLnR) return `00:00:${pad2(s)}`
  const m = Math.floor(s / 60), sec = s % 60
  return `${pad2(m)}:${pad2(sec)}`
}
function scoreColor(s: number, max = 6) {
  const pct = s / max
  return pct >= 0.75 ? '#1e7a1e' : pct >= 0.5 ? '#b8860b' : '#c0392b'
}

// Pick a supported mimeType for MediaRecorder
function getSupportedMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
  for (const m of candidates) {
    if (!m || MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

// NUM_BARS must match the number of frequency bins mapped below
const NUM_BARS = 10

function SpeakingPracticeContent({ mode }: { mode: Mode }) {
  const taskType      = TASK_TYPE_MAP[mode] ?? 'Listen and Repeat'
  const isLnR         = mode === 'listen-and-repeat'
  const RESPONSE_SECS = isLnR ? 8 : 45
  const searchParams  = useSearchParams()
  const router        = useNextRouter()

  const [tasks,       setTasks]   = useState<Task[]>([])
  const [idx,         setIdx]     = useState(0)
  const [phase,       setPhase]   = useState<'playing' | 'recording' | 'done-all'>('playing')
  const [timer,       setTimer]   = useState(RESPONSE_SECS)
  const [muted,       setMuted]   = useState(false)
  const [showResults, setShow]    = useState(false)
  const [results,     setResults] = useState<(AnalyzeResult | null | '_pending')[]>([])
  const [blobUrls,    setBlobUrls] = useState<(string | null)[]>([])
  const [showChecklist, setShowChecklist] = useState(false)
  const [clChecked,     setClChecked]     = useState<boolean[]>([])
  const [clNotes,       setClNotes]       = useState<string[]>([])
  const [clSaved,       setClSaved]       = useState(false)
  const [clGrading,     setClGrading]     = useState(false)

  // Self-prediction before results
  const [showPrediction, setShowPrediction] = useState(false)
  const [prediction, setPrediction] = useState<{ score: number | null; confidence: string | null }>({ score: null, confidence: null })

  // Diagnostic panel expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  // Real voice-activity levels (0–255) per bar
  const [vaBars,      setVaBars]  = useState<number[]>(new Array(NUM_BARS).fill(0))

  const mediaRef    = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const streamRef   = useRef<MediaStream | null>(null)
  const audioRef    = useRef<HTMLAudioElement | null>(null)
  const preloadRef  = useRef<(HTMLAudioElement | null)[]>([])
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const blobsRef    = useRef<(Blob | null)[]>([])
  const blobUrlsRef = useRef<(string | null)[]>([])
  const resultsRef  = useRef<(AnalyzeResult | null | '_pending')[]>([])
  const tasksRef    = useRef<Task[]>([])
  const idxRef      = useRef(0)
  const mutedRef    = useRef(false)
  const playingRef  = useRef<HTMLAudioElement | null>(null)

  // Voice-activity analyser
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vaRafRef    = useRef<number | null>(null)
  const vaDataRef   = useRef<Uint8Array<ArrayBuffer> | null>(null)

  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { idxRef.current = idx }, [idx])
  useEffect(() => { mutedRef.current = muted }, [muted])

  // Revoke blob URLs on unmount to prevent memory leaks — use ref so closure
  // captures the latest URLs, not the stale initial empty array
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(u => { if (u) URL.revokeObjectURL(u) })
    }
  }, [])

  // Auto-open prediction screen when done (gates the results overlay)
  useEffect(() => {
    if (phase === 'done-all') setShowPrediction(true)
  }, [phase])

  // Load tasks + warm mic
  useEffect(() => {
    const tid  = searchParams.get('task_id')
    const tags = searchParams.get('tags')
    const params: Record<string, string | number> = { task_type: taskType, page_size: 200 }
    if (tags) params.tags = tags
    api.get<TasksResp>('/api/task/bank', params).then(d => {
      const rows = d.rows
      if (!rows.length) return
      let list = tags ? [...rows] : [...rows].sort(() => Math.random() - 0.5)
      if (tid) {
        const found = list.findIndex(r => r.task_id === +tid)
        if (found > -1) { const [item] = list.splice(found, 1); list.unshift(item) }
      }
      blobsRef.current   = new Array(list.length).fill(null)
      blobUrlsRef.current = new Array(list.length).fill(null)
      resultsRef.current = new Array(list.length).fill(null)
      preloadRef.current = new Array(list.length).fill(null)
      setResults(new Array(list.length).fill(null))
      setBlobUrls(new Array(list.length).fill(null))
      setTasks(list)
      navigator.mediaDevices?.getUserMedia({ audio: true })
        .then(s => { streamRef.current = s })
        .catch(() => {})
    })
    return () => {
      stopVA()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [taskType, searchParams])

  // Auto-start on load
  useEffect(() => {
    if (tasks.length > 0) goTo(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length])

  // ── Voice-activity analyser ──────────────────────────────────────────────────

  function startVA(stream: MediaStream) {
    try {
      const ctx      = new AudioContext()
      const src      = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      src.connect(analyser)
      analyserRef.current = analyser
      vaDataRef.current   = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
      const tick = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(vaDataRef.current!)
        const data = vaDataRef.current!
        const step = Math.floor(data.length / NUM_BARS)
        const bars = Array.from({ length: NUM_BARS }, (_, i) => data[i * step] ?? 0)
        setVaBars(bars)
        vaRafRef.current = requestAnimationFrame(tick)
      }
      vaRafRef.current = requestAnimationFrame(tick)
    } catch { /* AudioContext not available */ }
  }

  function stopVA() {
    if (vaRafRef.current) { cancelAnimationFrame(vaRafRef.current); vaRafRef.current = null }
    analyserRef.current = null
    setVaBars(new Array(NUM_BARS).fill(0))
  }

  // ── Session logic ─────────────────────────────────────────────────────────────

  function stopAll() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop()
    stopVA()
  }

  function goTo(i: number) {
    const list = tasksRef.current
    if (i < 0 || i >= list.length) return
    stopAll()
    setIdx(i); idxRef.current = i
    setPhase('playing')
    setTimer(RESPONSE_SECS)
    playAudio(i, list)
  }

  function playAudio(i: number, list: Task[]) {
    // Request mic WHILE audio plays — mirrors v1 pattern.
    // This gives 2-3s for the permission dialog to resolve before onended fires,
    // so the stream is always ready when startRecording() is called.
    if (!streamRef.current) {
      navigator.mediaDevices?.getUserMedia({ audio: true })
        .then(s => { streamRef.current = s })
        .catch(() => {})
    }

    const path = list[i]?.audio_file
    if (!path) { startResponseTimer(i); return }
    let a: HTMLAudioElement
    if (preloadRef.current[i]) {
      a = preloadRef.current[i]!; preloadRef.current[i] = null
    } else {
      a = new Audio(`/api/speaking/audio?path=${encodeURIComponent(path)}`)
    }
    if (mutedRef.current) a.volume = 0
    audioRef.current = a
    a.onended = () => startResponseTimer(i)
    a.onerror = () => startResponseTimer(i)
    a.play().catch(() => startResponseTimer(i))
    const next = i + 1
    if (next < list.length && list[next]?.audio_file && !preloadRef.current[next]) {
      const pre = new Audio(`/api/speaking/audio?path=${encodeURIComponent(list[next].audio_file!)}`)
      pre.preload = 'auto'; preloadRef.current[next] = pre
    }
  }

  function startResponseTimer(i: number) {
    setPhase('recording')
    let sec = RESPONSE_SECS
    setTimer(sec)
    startRecording()
    timerRef.current = setInterval(() => {
      sec--; setTimer(sec)
      if (sec <= 0) {
        clearInterval(timerRef.current!); timerRef.current = null
        stopRecordingAndAdvance(i)
      }
    }, 1000)
  }

  function startRecording() {
    function doRecord(stream: MediaStream) {
      const mime = getSupportedMime()
      let mr: MediaRecorder
      try {
        mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      } catch {
        mr = new MediaRecorder(stream)
      }
      chunksRef.current = []
      // Use 100ms timeslices — guarantees data even for short recordings
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(100)
      mediaRef.current = mr
      startVA(stream)
    }
    if (streamRef.current) {
      doRecord(streamRef.current)
    } else {
      navigator.mediaDevices?.getUserMedia({ audio: true })
        .then(s => { streamRef.current = s; doRecord(s) })
        .catch(() => {})
    }
  }

  function stopRecordingAndAdvance(i: number) {
    const captured = i
    stopVA()

    function advance() {
      if (captured < tasksRef.current.length - 1) {
        setTimeout(() => goTo(captured + 1), 300)
      } else {
        setPhase('done-all')
      }
    }

    if (!mediaRef.current || mediaRef.current.state !== 'recording') {
      advance()
      return
    }

    const mr = mediaRef.current
    mediaRef.current = null

    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
      if (blob.size > 0) {
        blobsRef.current[captured] = blob
        const url = URL.createObjectURL(blob)
        blobUrlsRef.current[captured] = url
        setBlobUrls(prev => { const next = [...prev]; next[captured] = url; return next })
        resultsRef.current[captured] = '_pending'
        setResults([...resultsRef.current])
        analyzeTask(captured, blob)
      } else {
        // Empty blob — mark as error so row doesn't stay "Not recorded"
        resultsRef.current[captured] = { _error: 'empty recording' } as AnalyzeResult
        setResults([...resultsRef.current])
      }
      advance()
    }
    mr.stop()
  }

  async function analyzeTask(i: number, blob: Blob) {
    const task = tasksRef.current[i]
    if (!task) return
    const fd = new FormData()
    fd.append('audio', blob, `recording_${i}.webm`)
    fd.append('task_id', String(task.task_id))
    fd.append('task_type', taskType)
    if (isLnR) fd.append('expected_answer', task.question)
    else       fd.append('topic', task.question)
    try {
      const res = await fetch('/api/speaking/analyze', {
        method: 'POST', body: fd,
        credentials: 'include',
      })
      if (!res.ok) throw new Error(await res.text())
      const data: AnalyzeResult = await res.json()
      resultsRef.current[i] = data
      setResults([...resultsRef.current])
    } catch (e: unknown) {
      resultsRef.current[i] = { _error: (e instanceof Error ? e.message : 'unknown') } as AnalyzeResult
      setResults([...resultsRef.current])
    }
  }

  function playRecording(i: number) {
    if (playingRef.current) { playingRef.current.pause(); playingRef.current = null }
    const url = blobUrls[i]
    if (!url) return
    const a = new Audio(url)
    playingRef.current = a
    a.play().catch(() => {})
    a.onended = () => { playingRef.current = null }
  }

  function handleToggleMuted() {
    setMuted(m => {
      const next = !m
      if (audioRef.current) audioRef.current.volume = next ? 0 : 1
      mutedRef.current = next
      return next
    })
  }

  const task  = tasks[idx]
  const total = tasks.length
  const subLabel = `Question ${idx + 1} of ${total || '…'}`

  const phaseTitle =
    phase === 'playing'    ? (isLnR ? 'Listen and repeat only once.' : 'Please answer the interviewer\u2019s questions.')
    : phase === 'recording' ? (isLnR ? 'Repeat the sentence now.'     : 'Answer the question now.')
    : 'All done!'

  const isRecording = phase === 'recording'

  return (
    <div style={{ background: '#d9d9d9', minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '24px 0', fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <div style={{ width: 1046, maxWidth: '96vw', background: '#fff', border: '1px solid #bbb', display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <div style={{ background: '#1e7373', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
          <a href={`/practice/speaking/${mode}`} style={{ color: '#fff', textDecoration: 'none', fontFamily: 'Arial, sans-serif', fontSize: 14 }}>← Back</a>
          <span style={{ color: '#fff', fontFamily: 'Arial, sans-serif', fontSize: 15, fontWeight: 'bold' }}>toeflindo</span>
          <button onClick={handleToggleMuted}
            style={{ background: 'transparent', border: '1.5px solid #fff', color: '#fff', borderRadius: 20, padding: '6px 16px', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fontSize: 13, cursor: 'pointer', opacity: muted ? 0.6 : 1 }}>
            {muted ? '🔇 Muted' : '🔊 Volume'}
          </button>
        </div>

        {/* Breadcrumb */}
        <div style={{ padding: '12px 24px', fontFamily: 'Arial, sans-serif', fontSize: 14, borderBottom: '1px solid #ddd' }}>
          <b>Speaking</b><span style={{ color: '#999', margin: '0 8px' }}>|</span><b>{subLabel}</b>
        </div>

        {/* Content */}
        <div style={{ border: '1px solid #333', margin: 14, padding: '40px 20px 50px', textAlign: 'center', flex: 1 }}>
          <h1 style={{ fontSize: 22, marginBottom: 30, fontFamily: "Georgia, 'Times New Roman', serif" }}>
            {total === 0 ? 'Loading…' : phaseTitle}
          </h1>

          {/* Interview: show question text when recording */}
          {!isLnR && task && isRecording && (
            <div style={{ background: '#eaf5f3', border: '1px solid #c5dedd', borderRadius: 8, padding: '16px 24px', maxWidth: 600, margin: '0 auto 28px', fontSize: 15, color: '#1f2937', textAlign: 'left', lineHeight: 1.6 }}>
              {task.question}
            </div>
          )}

          {/* Response time box */}
          <div style={{ width: 266, margin: '0 auto', border: '1px solid #1e7373' }}>
            <div style={{ background: '#1e7373', color: '#fff', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fontSize: 13, letterSpacing: 0.5, padding: '10px 0', textAlign: 'center' }}>
              RESPONSE TIME
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '14px 0' }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                border: `1.5px solid ${isRecording ? '#c0392b' : '#888'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isRecording ? '#c0392b' : '#666', fontSize: 13,
                boxShadow: isRecording ? '0 0 0 4px rgba(192,57,43,0.2)' : 'none',
                transition: 'all 0.3s',
              }}>🎙</div>
              <div style={{ fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fontSize: 17, color: '#222' }}>
                {isRecording ? fmtTimer(timer, isLnR) : '--:--'}
              </div>
            </div>
          </div>

          {/* Voice-activity bars — OUTSIDE the box, below it */}
          <div style={{ height: 44, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 4, marginTop: 14 }}>
            {vaBars.map((level, j) => {
              const h = isRecording ? Math.max(4, Math.round((level / 255) * 32)) : 3
              return (
                <div key={j} style={{
                  width: 5, height: h, borderRadius: 3,
                  background: isRecording ? '#c0392b' : '#ccc',
                  opacity: isRecording ? 0.75 + (level / 255) * 0.25 : 0.3,
                  transition: 'height 0.08s ease-out, background 0.3s',
                }} />
              )
            })}
          </div>
        </div>
      </div>

      {/* Self-prediction overlay — shown before results */}
      {showPrediction && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', zIndex: 998, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '0 16px' }}>
          <div style={{ background: '#fff', borderRadius: 10, maxWidth: 420, width: '100%', padding: 'clamp(20px,5vw,32px)' }}>
            <h2 style={{ fontFamily: 'Arial, sans-serif', color: '#1e7373', marginTop: 0, marginBottom: 8, fontSize: 18 }}>
              How do you think you did?
            </h2>
            <p style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#6b7280', marginBottom: 20, marginTop: 0 }}>
              Make a prediction before seeing your results.
            </p>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Expected band score</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5, 6].map(s => (
                  <button key={s} onClick={() => setPrediction(p => ({ ...p, score: s }))}
                    style={{ padding: '7px 14px', borderRadius: 6, border: `1.5px solid ${prediction.score === s ? '#1e7373' : '#e5e7eb'}`, background: prediction.score === s ? '#1e7373' : '#fff', color: prediction.score === s ? '#fff' : '#374151', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'Arial, sans-serif' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Confidence</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Guessing', 'Somewhat confident', 'Confident', 'Very confident'].map(c => (
                  <button key={c} onClick={() => setPrediction(p => ({ ...p, confidence: c }))}
                    style={{ padding: '7px 12px', borderRadius: 6, border: `1.5px solid ${prediction.confidence === c ? '#1e7373' : '#e5e7eb'}`, background: prediction.confidence === c ? '#1e7373' : '#fff', color: prediction.confidence === c ? '#fff' : '#374151', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'Arial, sans-serif' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => { setShowPrediction(false); setShow(true) }}
              disabled={prediction.score === null || prediction.confidence === null}
              style={{ width: '100%', background: prediction.score !== null && prediction.confidence !== null ? '#1e7373' : '#9ca3af', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 0', fontSize: 15, fontWeight: 700, cursor: prediction.score !== null && prediction.confidence !== null ? 'pointer' : 'not-allowed', fontFamily: 'Arial, sans-serif' }}>
              See my results →
            </button>
          </div>
        </div>
      )}

      {/* Results overlay */}
      {showResults && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 40 }}>
          <div style={{ background: '#fff', borderRadius: 8, maxWidth: 980, width: '96vw', maxHeight: '85vh', overflowY: 'auto', padding: 'clamp(12px, 4vw, 30px)' }}>
            <h2 style={{ fontFamily: 'Arial, sans-serif', color: '#1e7373', marginBottom: 20, textAlign: 'center' }}>Results</h2>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
            <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontFamily: 'Arial, sans-serif', fontSize: 13 }}>
              <thead>
                <tr>
                  {[
                    '#', 'Play', 'Download', 'Transcript',
                    'Raw (0-5)', 'Band (1-6)',
                    'Diagnostic', 'Rationale'
                  ].map(h => (
                    <th key={h} style={{ background: '#1e7373', color: '#fff', padding: '8px 6px', textAlign: 'left', fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
                </thead>
                <tbody>
                {tasks.map((t, i) => {
                  const r         = results[i]
                  const isPending = r === '_pending'
                  const data      = (r && r !== '_pending') ? r as AnalyzeResult : null
                  const hasBlob   = !!blobsRef.current[i]
                  const hasUrl    = !!blobUrls[i]
                  const isExpanded = expandedRows.has(i)
                  const dimKeys = isLnR
                    ? (['fluency', 'intelligibility', 'repeat_accuracy'] as const)
                    : (['fluency', 'intelligibility', 'language_use', 'organization'] as const)
                  const dimLabels = isLnR
                    ? ['Fluency', 'Intell.', 'Repeat Acc.']
                    : ['Fluency', 'Intell.', 'Lang Use', 'Org.']
                  return (
                    <Fragment key={i}>
                    <tr style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px 6px', verticalAlign: 'middle', width: 28 }}>{i + 1}</td>
                      {/* Play — uses in-memory blob URL (only while page is open) */}
                      <td style={{ padding: '8px 6px', verticalAlign: 'middle', width: 48 }}>
                        {hasUrl
                          ? <button onClick={() => playRecording(i)} title="Play your recording"
                              style={{ background: '#1e7373', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▶</button>
                          : data?.recording_filename
                            ? <audio controls src={`/api/speaking/recording/${data.recording_filename}`}
                                style={{ height: 28, width: 160, verticalAlign: 'middle' }} />
                            : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
                        }
                      </td>
                      {/* Download — saves the webm to device */}
                      <td style={{ padding: '8px 6px', verticalAlign: 'middle', width: 56 }}>
                        {blobUrls[i]
                          ? <a href={blobUrls[i]!} download={`q${i + 1}_${mode}.webm`} title="Download recording"
                              style={{ background: '#1e7373', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', color: '#fff', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>↓</a>
                          : data?.recording_filename
                            ? <a href={`/api/speaking/recording/${data.recording_filename}`} download={data.recording_filename} title="Download recording"
                                style={{ background: '#555', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', color: '#fff', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>↓</a>
                            : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '8px 6px', verticalAlign: 'top', fontStyle: 'italic', color: '#555', maxWidth: 220 }}>
                        {!hasBlob
                          ? <span style={{ color: '#9ca3af' }}>Not recorded</span>
                          : data
                            ? (data._error
                                ? <span style={{ color: '#c0392b' }}>Error: {data._error}</span>
                                : data.status === 'RECORD_AGAIN'
                                  ? <span style={{ color: '#b45309' }}>⚠ {data.message}</span>
                                  : `"${data.transcript}"`)
                            : <span style={{ color: '#888' }}>Analyzing…</span>
                        }
                      </td>
                      {/* Raw score 0-5 */}
                      <td style={{ padding: '8px 6px', verticalAlign: 'top', fontWeight: 'bold', color: data && !data._error && data.status !== 'RECORD_AGAIN' ? scoreColor(data.task_raw_score ?? data.rubric_score, 5) : '#9ca3af' }}>
                        {data && !data._error && data.status !== 'RECORD_AGAIN' ? `${(data.task_raw_score ?? data.rubric_score).toFixed(2)}/5` : (isPending ? '…' : '-')}
                      </td>
                      {/* Band score 1.0-6.0 — primary holistic score */}
                      <td style={{ padding: '8px 6px', verticalAlign: 'top', fontWeight: 'bold', color: data && !data._error && data.status !== 'RECORD_AGAIN' ? scoreColor(data.estimated_band ?? data.rubric_score) : '#9ca3af' }}>
                        {data && !data._error && data.status !== 'RECORD_AGAIN' ? `${(data.estimated_band ?? data.rubric_score).toFixed(1)}` : (isPending ? '…' : '-')}
                      </td>
                      {/* Diagnostic toggle */}
                      <td style={{ padding: '8px 6px', verticalAlign: 'top' }}>
                        {data && !data._error && data.status !== 'RECORD_AGAIN' ? (
                          <button
                            onClick={() => setExpandedRows(prev => {
                              const next = new Set(prev)
                              next.has(i) ? next.delete(i) : next.add(i)
                              return next
                            })}
                            style={{ background: 'none', border: '1px solid #c5dedd', borderRadius: 4, color: '#1e7373', fontSize: 11, cursor: 'pointer', padding: '2px 6px', whiteSpace: 'nowrap' }}
                          >
                            {isExpanded ? 'Hide ▲' : 'Show ▼'}
                          </button>
                        ) : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 6px', verticalAlign: 'top', fontSize: 12, color: '#555', maxWidth: 260 }}>
                        {data && !data._error && data.status !== 'RECORD_AGAIN' ? data.rubric_rationale : (isPending ? <span style={{ color: '#9ca3af' }}>waiting…</span> : '-')}
                      </td>
                    </tr>
                    {/* Interview tips — separate row so it doesn't break the column count */}
                    {!isLnR && data && !data._error && data.status !== 'RECORD_AGAIN' && (data.coherence_tip || data.marker_tip) && (
                      <tr key={`tips-${i}`} style={{ background: '#f0faf8' }}>
                        <td colSpan={8} style={{ padding: '4px 6px 8px', borderTop: '1px dashed #c5dedd' }}>
                          {data.coherence_tip && <div style={{ fontSize: 11, color: '#1e7373', marginBottom: 2 }}>💡 Coherence: {data.coherence_tip}</div>}
                          {data.marker_tip    && <div style={{ fontSize: 11, color: '#1e7373' }}>🔗 Markers ({data.marker_count} found{data.markers_found?.length ? ': ' + data.markers_found.slice(0,3).join(', ') : ''}): {data.marker_tip}</div>}
                        </td>
                      </tr>
                    )}
                    {/* Diagnostic sub-row — collapsed by default */}
                    {isExpanded && data && !data._error && (
                      <tr key={`diag-${i}`} style={{ background: '#f9fafb' }}>
                        <td colSpan={8} style={{ padding: '8px 12px', borderTop: '1px dashed #e5e7eb' }}>
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                            {dimKeys.map((dim, di) => {
                              const v = data.llm_dimension_scores?.[dim]
                              return (
                                <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 11, color: '#6b7280' }}>{dimLabels[di]}:</span>
                                  <span style={{ fontWeight: 700, fontSize: 12, color: v != null ? scoreColor(v, 5) : '#9ca3af' }}>
                                    {v != null ? `${v}/5` : '—'}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 5, fontStyle: 'italic' }}>
                            Diagnostic signals — not official ETS scoring components.
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>
            <div style={{ textAlign: 'center', marginTop: 20, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setShow(false)}
                style={{ background: '#1e7373', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}>Review</button>
              <button onClick={async () => {
                const items = isLnR ? LNR_CHECKLIST : IV_CHECKLIST
                setClChecked(new Array(items.length).fill(false))
                setClNotes(new Array(items.length).fill(''))
                setClSaved(false)
                setClGrading(true)
                setShowChecklist(true)
                // Build session_results from completed analyses
                const sessionResults = (resultsRef.current as (AnalyzeResult | null | '_pending')[])
                  .map((r, i) => {
                    if (!r || r === '_pending') return null
                    const data = r as AnalyzeResult
                    if (data._error) return null
                    return {
                      transcript: data.transcript,
                      expected_answer: tasksRef.current[i]?.question || '',
                      topic: isLnR ? '' : (tasksRef.current[i]?.question || ''),
                      filler_count: data.filler_count,
                      pause_count: data.pause_count,
                      marker_count: data.marker_count,
                      has_example: data.has_example,
                      wpm: data.wpm,
                      pronunciation_score: data.pronunciation_score,
                      fluency_score: data.fluency_score,
                    }
                  })
                  .filter(Boolean)
                try {
                  const res = await fetch('/api/speaking/checklist/grade', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ task_type: taskType, session_results: sessionResults }),
                  })
                  const data = await res.json()
                  if (data.results) {
                    setClChecked(data.results.map((r: { passed: boolean }) => r.passed))
                    setClNotes(data.results.map((r: { note: string }) => r.note || ''))
                  }
                } catch { /* leave unchecked */ }
                setClGrading(false)
              }}
                style={{ background: '#2a7a7a', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}>✅ Self-Check</button>
              {!isLnR && (
                <button onClick={() => router.push('/practice/speaking/mistakes')}
                  style={{ background: '#1e7373', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}>🔁 Practice Mistakes</button>
              )}
              <button onClick={() => router.push(`/practice/speaking/${mode}`)}
                style={{ background: '#1e7373', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}>Back to {isLnR ? 'L&R' : 'Interview'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Self-Check Checklist Modal ── */}
      {showChecklist && (() => {
        const items = isLnR ? LNR_CHECKLIST : IV_CHECKLIST
        const passedCount = clChecked.filter(Boolean).length
        async function saveChecklist() {
          const payload = {
            task_type: taskType,
            results: items.map((text, i) => ({ item: i + 1, text, passed: clChecked[i] ?? false, note: clNotes[i] ?? '' })),
          }
          try {
            await fetch('/api/speaking/checklist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(payload),
            })
            setClSaved(true)
          } catch { /* silent */ }
        }
        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 40 }}>
            <div style={{ background: '#fff', borderRadius: 8, maxWidth: 580, width: '96vw', maxHeight: '85vh', overflowY: 'auto', padding: 'clamp(14px,4vw,28px)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontFamily: 'Arial, sans-serif', color: '#1e7373', margin: 0, fontSize: 18 }}>
                  {isLnR ? 'Listen & Repeat' : 'Take an Interview'} — Self-Check
                </h2>
                <button onClick={() => setShowChecklist(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280', lineHeight: 1 }}>×</button>
              </div>

              {clGrading ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#6b7280', fontFamily: 'Arial, sans-serif' }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
                  <div style={{ fontSize: 14 }}>Grading your session with AI…</div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                    {items.map((text, i) => (
                      <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '8px 10px', borderRadius: 6, border: `1px solid ${clChecked[i] ? '#bbf7d0' : '#fecdd3'}`, background: clChecked[i] ? '#f0fdf4' : '#fff7f7', transition: 'all 0.15s' }}>
                        <input
                          type="checkbox"
                          checked={clChecked[i] ?? false}
                          onChange={e => {
                            const next = [...clChecked]
                            next[i] = e.target.checked
                            setClChecked(next)
                            setClSaved(false)
                          }}
                          style={{ marginTop: 3, accentColor: '#1e7373', width: 16, height: 16, flexShrink: 0 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                            <span style={{ color: '#9ca3af', marginRight: 5, fontSize: 11 }}>{i + 1}.</span>
                            {text}
                          </div>
                          {clNotes[i] && (
                            <div style={{ fontSize: 11, color: clChecked[i] ? '#16a34a' : '#be123c', marginTop: 3 }}>
                              {clNotes[i]}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <span style={{ fontSize: 13, color: passedCount === items.length ? '#16a34a' : '#6b7280', fontWeight: 600 }}>
                      {passedCount} / {items.length} passed
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {clSaved
                        ? <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, padding: '8px 16px' }}>✓ Saved</span>
                        : <button onClick={saveChecklist}
                            style={{ background: '#1e7373', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}>
                            Save
                          </button>
                      }
                      <button onClick={() => setShowChecklist(false)}
                        style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
                        Close
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function SpeakingPracticePage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = use(params)
  return <RequireAuth><SpeakingPracticeContent mode={mode as Mode} /></RequireAuth>
}
