'use client'

import { use } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'

interface Task { task_id: number; question: string; task_type: string }
interface TasksResp { rows: Task[] }
interface SubmitResult {
  practice_id: number
  score: number | null
  feedback: string
  strengths: string[]
  improvements: string[]
  corrected_version: string | null
  word_count: number
}

interface ChecklistItem {
  item: number
  text: string
  passed: boolean
  note: string
}

interface ChecklistResult {
  checklist_log_id: number
  task_type: string
  passed_count: number
  total_count: number
  results: ChecklistItem[]
  improvement_note: string
}

const TASK_TYPE_MAP: Record<string, string> = {
  email:      'Write an Email',
  discussion: 'Write for an Academic Discussion',
}
const TIME_LIMITS: Record<string, number> = {
  'Write an Email': 7 * 60,
  'Write for an Academic Discussion': 10 * 60,
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toString().padStart(2, '0')
  return `00:${m}:${s}`
}

function countWords(text: string) {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

function WritingEditorContent({ type }: { type: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const taskType  = TASK_TYPE_MAP[type] ?? 'Write an Email'
  const timeLimit = TIME_LIMITS[taskType] ?? 420

  const [task,        setTask]       = useState<Task | null>(null)
  const [essay,       setEssay]      = useState('')
  const [customLimit, setCustomLimit] = useState(timeLimit)
  const [seconds,     setSec]        = useState(timeLimit)
  const [started,     setStarted]    = useState(false)
  const [timerVis,    setTmrVis]    = useState(true)
  const [wcVis,       setWcVis]     = useState(true)
  const [loading,     setLoad]       = useState(false)
  const [result,      setResult]     = useState<SubmitResult | null>(null)
  const [checklist,   setChecklist]  = useState<ChecklistResult | null>(null)
  const [checklistLoading, setChecklistLoad] = useState(false)
  const [editingTimer, setEditingTimer] = useState(false)
  const [timerInput,   setTimerInput]   = useState('')
  // Self-prediction before results
  const [pendingResult, setPendingResult] = useState<SubmitResult | null>(null)
  const [showPrediction, setShowPrediction] = useState(false)
  const [prediction, setPrediction] = useState<{ score: number | null; confidence: string | null }>({ score: null, confidence: null })
  // Mobile: show question or editor
  const [mobileTab, setMobileTab] = useState<'question' | 'editor'>('question')

  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const taRef     = useRef<HTMLTextAreaElement>(null)
  const essayRef  = useRef('')          // always tracks latest essay for stale-closure safety
  const histRef   = useRef<string[]>([''])
  const histIdxRef = useRef(0)
  const autoSubmitRef = useRef(false)   // flag to trigger submit outside setSec callback

  // Load task
  useEffect(() => {
    const tid = searchParams.get('task_id')
    const revisionOf = searchParams.get('revision_of')
    const prefill = searchParams.get('prefill')
    api.get<TasksResp>('/api/task/bank', { task_type: taskType, page_size: 200 }).then(d => {
      const rows = d.rows
      if (!rows.length) return
      const found = tid ? rows.find(r => r.task_id === +tid) : rows[Math.floor(Math.random() * rows.length)]
      setTask(found ?? rows[0])
      setSec(timeLimit)
      if (prefill) {
        const decoded = decodeURIComponent(prefill)
        setEssay(decoded)
        essayRef.current = decoded
      }
    })
  }, [taskType, searchParams, timeLimit])

  // Auto-submit when timer hits 0
  useEffect(() => {
    if (!started) return
    timerRef.current = setInterval(() => {
      setSec(s => {
        if (s <= 1) {
          clearInterval(timerRef.current!)
          autoSubmitRef.current = true  // signal submit outside state updater
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started])

  // Watch for auto-submit signal — safe to call async here
  useEffect(() => {
    if (autoSubmitRef.current) {
      autoSubmitRef.current = false
      handleAutoSubmit()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds])

  // When started on mobile, switch to editor tab
  useEffect(() => {
    if (started) setMobileTab('editor')
  }, [started])

  async function handleSubmit() {
    if (!task) return
    if (timerRef.current) clearInterval(timerRef.current)
    const currentEssay = essayRef.current  // read from ref — safe against stale closure
    if (!currentEssay.trim()) {
      alert('Please write your response before submitting.')
      return
    }
    setLoad(true)
    try {
      const elapsed = customLimit - seconds
      const revisionOf = searchParams.get('revision_of')
      const res = await api.post<SubmitResult>('/api/practice/writing/submit', {
        task_id: task.task_id,
        task_type: taskType,
        essay: currentEssay,
        time_spent_sec: elapsed,
        is_revision: !!revisionOf,
        revision_of: revisionOf ? parseInt(revisionOf) : undefined,
      })
      setPendingResult(res)
      setShowPrediction(true)
      setChecklist(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setLoad(false)
    }
  }

  // Auto-submit when timer expires — bypasses the empty-essay guard so the
  // session is always recorded even if the user wrote nothing.
  async function handleAutoSubmit() {
    if (!task) return
    if (timerRef.current) clearInterval(timerRef.current)
    const currentEssay = essayRef.current  // read from ref — safe against stale closure
    setLoad(true)
    try {
      const elapsed = customLimit  // timer hit 0, full time was used
      const revisionOf = searchParams.get('revision_of')
      const res = await api.post<SubmitResult>('/api/practice/writing/submit', {
        task_id: task.task_id,
        task_type: taskType,
        essay: currentEssay || '',
        time_spent_sec: elapsed,
        is_revision: !!revisionOf,
        revision_of: revisionOf ? parseInt(revisionOf) : undefined,
      })
      setPendingResult(res)
      setShowPrediction(true)
      setChecklist(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setLoad(false)
    }
  }

  async function handleChecklist() {
    if (!result) return
    setChecklistLoad(true)
    try {
      const res = await api.post<ChecklistResult>('/api/writing/checklist', {
        task_type: taskType,
        essay: essayRef.current,   // use ref — same stale-closure fix as handleSubmit
        practice_log_id: result.practice_id ?? null,
      })
      setChecklist(res)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Checklist failed')
    } finally {
      setChecklistLoad(false)
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    setEssay(v)
    essayRef.current = v   // keep ref in sync for stale-closure safety
    const hist = histRef.current.slice(0, histIdxRef.current + 1)
    hist.push(v)
    histRef.current = hist
    histIdxRef.current = hist.length - 1
  }

  function handleCut() {
    const ta = taRef.current
    if (!ta) return
    const { selectionStart: s, selectionEnd: e } = ta
    if (s !== e) {
      navigator.clipboard.writeText(ta.value.substring(s, e))
      const next = ta.value.substring(0, s) + ta.value.substring(e)
      setEssay(next)
      essayRef.current = next
    }
  }
  function handlePaste() {
    navigator.clipboard.readText().then(t => {
      const ta = taRef.current
      if (!ta) return
      const s = ta.selectionStart
      const next = ta.value.substring(0, s) + t + ta.value.substring(ta.selectionEnd)
      setEssay(next)
      essayRef.current = next
    })
  }
  function handleUndo() {
    if (histIdxRef.current > 0) {
      histIdxRef.current--
      const v = histRef.current[histIdxRef.current]
      setEssay(v)
      essayRef.current = v
    }
  }
  function handleRedo() {
    if (histIdxRef.current < histRef.current.length - 1) {
      histIdxRef.current++
      const v = histRef.current[histIdxRef.current]
      setEssay(v)
      essayRef.current = v
    }
  }

  function commitTimerEdit() {
    const mins = parseFloat(timerInput)
    if (!isNaN(mins) && mins > 0) {
      const secs = Math.round(mins * 60)
      setCustomLimit(secs)
      setSec(secs)
    }
    setEditingTimer(false)
    setTimerInput('')
  }

  const wc = countWords(essay)
  const isEmail = type === 'email'
  const subLabel = isEmail ? 'Question 1 of 2' : 'Question 2 of 2'

  // Parse email fields from task question
  let emailTo = ''
  let emailSubject = ''
  let leftContent = task?.question ?? ''
  if (isEmail && task) {
    const toMatch = task.question.match(/To:\s*(.+)/i)
    const subjMatch = task.question.match(/Subject:\s*(.+)/i)
    if (toMatch) emailTo = toMatch[1].trim()
    if (subjMatch) emailSubject = subjMatch[1].trim()
  }

  const timerColor = seconds <= 60 && started ? '#dc2626'
    : seconds <= 120 && started ? '#b45309' : '#1f2937'

  return (
    <div className="writing-shell">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .skel {
          background: linear-gradient(90deg, #e8e8e8 25%, #f4f4f4 50%, #e8e8e8 75%);
          background-size: 800px 100%;
          animation: shimmer 1.4s infinite linear;
          border-radius: 4px;
        }

        .writing-shell {
          background: #b0b0b0;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          font-family: Arial, sans-serif;
          font-size: 14px;
        }
        .writing-frame {
          width: 1060px;
          min-width: 0;
          max-width: 100%;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #e8e8e8;
        }
        .writing-topbar {
          background: #2a7a7a;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          flex-shrink: 0;
        }
        .writing-subbar {
          background: #f5f5f5;
          border-bottom: 1px solid #ccc;
          min-height: 36px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 16px;
          flex-shrink: 0;
          flex-wrap: wrap;
          gap: 6px;
        }
        /* Mobile tab switcher */
        .writing-tabs {
          display: none;
          background: #e8e8e8;
          border-bottom: 1px solid #ccc;
        }
        .writing-tab-btn {
          flex: 1;
          padding: 10px 0;
          border: none;
          background: transparent;
          font-size: 13px;
          font-weight: 600;
          color: #6b7280;
          cursor: pointer;
          border-bottom: 2px solid transparent;
        }
        .writing-tab-btn.active {
          color: #2a7a7a;
          border-bottom-color: #2a7a7a;
        }
        .writing-panels {
          flex: 1;
          display: flex;
          background: white;
          margin: 8px;
          border: 1px solid #ccc;
          overflow: hidden;
          min-height: 400px;
        }
        .writing-left {
          width: 400px;
          min-width: 300px;
          border-right: 1px solid #ccc;
          padding: 20px;
          overflow-y: auto;
          line-height: 1.6;
          color: #5a2d82;
        }
        .writing-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 20px;
          min-width: 0;
        }
        .writing-toolbar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 0;
          border-top: 1px solid #ddd;
          border-bottom: 1px solid #ddd;
          margin-bottom: 0;
          flex-wrap: wrap;
        }
        .toolbar-btn {
          padding: 6px 14px;
          border: 1px solid #ccc;
          background: white;
          cursor: pointer;
          font-size: 13px;
          border-radius: 2px;
          color: #333;
          white-space: nowrap;
        }
        .writing-textarea {
          flex: 1;
          border: none;
          outline: none;
          resize: none;
          font-size: 14px;
          line-height: 1.6;
          font-family: Arial, sans-serif;
          padding: 10px 0;
          color: #333;
          width: 100%;
          background: transparent;
          min-height: 200px;
        }

        /* ── Responsive ── */
        @media (max-width: 700px) {
          .writing-shell { background: #e8e8e8; }
          .writing-frame { width: 100%; }
          .writing-panels { flex-direction: column; margin: 0; border: none; border-top: 1px solid #ccc; min-height: 0; }
          .writing-left  { width: 100%; min-width: 0; border-right: none; border-bottom: 1px solid #ccc; padding: 14px; }
          .writing-right { padding: 14px; }
          .writing-tabs  { display: flex; }
          /* Hide panels based on active tab — controlled via data attribute */
          .writing-panels[data-tab="editor"]   .writing-left  { display: none; }
          .writing-panels[data-tab="question"] .writing-right { display: none; }
        }
        @media (max-width: 400px) {
          .toolbar-btn { padding: 6px 8px; font-size: 12px; }
          .writing-topbar { padding: 0 12px; }
        }
      `}</style>

      <div className="writing-frame">
        {/* Top bar */}
        <div className="writing-topbar">
          <a href={`/practice/writing/${type}`} style={{ color: '#d4e8e8', textDecoration: 'none', fontSize: 14 }}>← Back</a>
          {!started ? (
            <button onClick={() => setStarted(true)}
              style={{ background: 'white', color: '#333', border: 'none', padding: '8px 20px', fontSize: 15, fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 3 }}>
              Start <span style={{ fontSize: 18, color: '#2a7a7a', fontWeight: 'bold' }}>›</span>
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={loading}
              style={{ background: loading ? '#ccc' : 'white', color: '#333', border: 'none', padding: '8px 20px', fontSize: 15, fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 3 }}>
              {loading ? 'Scoring…' : 'Submit ›'}
            </button>
          )}
        </div>

        {/* Sub-bar */}
        <div className="writing-subbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 'bold' }}>Writing</span>
            <span style={{ color: '#999' }}>|</span>
            <span>{subLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {editingTimer ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={timerInput}
                  onChange={e => setTimerInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitTimerEdit(); if (e.key === 'Escape') { setEditingTimer(false); setTimerInput('') } }}
                  autoFocus
                  placeholder={String(Math.round(customLimit / 60))}
                  style={{ width: 64, padding: '3px 6px', fontSize: 13, border: '1px solid #2a7a7a', borderRadius: 3, outline: 'none', textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: '#666' }}>min</span>
                <button onClick={commitTimerEdit}
                  style={{ padding: '3px 10px', background: '#2a7a7a', color: 'white', border: 'none', borderRadius: 3, fontSize: 12, cursor: 'pointer', fontWeight: 'bold' }}>
                  Set
                </button>
                <button onClick={() => { setEditingTimer(false); setTimerInput('') }}
                  style={{ padding: '3px 8px', background: 'none', color: '#999', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, cursor: 'pointer' }}>
                  ✕
                </button>
              </div>
            ) : (
              <>
                <span style={{ fontWeight: 'bold', visibility: timerVis ? 'visible' : 'hidden', color: timerColor }}>
                  {fmtTime(seconds)}
                </span>
                {!started && (
                  <button onClick={() => { setTimerInput(String(Math.round(customLimit / 60))); setEditingTimer(true) }}
                    title="Change timer"
                    style={{ background: 'none', border: '1px solid #b0c8c8', borderRadius: 3, color: '#2a7a7a', cursor: 'pointer', padding: '2px 7px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    ✎ {Math.round(customLimit / 60)}m
                  </button>
                )}
              </>
            )}
            <button onClick={() => setTmrVis(v => !v)}
              style={{ color: '#2a7a7a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 'bold', border: 'none', background: 'none', fontSize: 14 }}>
              <svg viewBox="0 0 24 16" style={{ width: 22, height: 14, fill: 'none', stroke: '#2a7a7a', strokeWidth: 1.8 }}>
                <ellipse cx="12" cy="8" rx="11" ry="7" />
                <circle cx="12" cy="8" r="3.5" fill="#2a7a7a" stroke="none" />
              </svg>
              {timerVis ? 'Hide Time' : 'Show Time'}
            </button>
          </div>
        </div>

        {/* Mobile tab switcher */}
        <div className="writing-tabs">
          <button
            className={`writing-tab-btn ${mobileTab === 'question' ? 'active' : ''}`}
            onClick={() => setMobileTab('question')}>
            Question
          </button>
          <button
            className={`writing-tab-btn ${mobileTab === 'editor' ? 'active' : ''}`}
            onClick={() => setMobileTab('editor')}>
            Your Answer {wc > 0 ? `(${wc}w)` : ''}
          </button>
        </div>

        {/* Main content panels */}
        <div className="writing-panels" data-tab={mobileTab}>

          {/* Left panel — question */}
          <div className="writing-left">
            {!task ? (
              <p style={{ color: '#9ca3af' }}>Loading task…</p>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7 }}>
                {leftContent}
              </div>
            )}
          </div>

          {/* Right panel — editor */}
          <div className="writing-right">
            <div style={{ fontWeight: 'bold', fontSize: 15, marginBottom: 14 }}>Your Response:</div>

            {isEmail && (emailTo || emailSubject) && (
              <div style={{ marginBottom: 10, lineHeight: 1.8 }}>
                {emailTo && <p style={{ fontWeight: 'bold', fontSize: 14 }}>To: {emailTo}</p>}
                {emailSubject && <p style={{ fontWeight: 'bold', fontSize: 14 }}>Subject: {emailSubject}</p>}
              </div>
            )}

            {/* Toolbar */}
            <div className="writing-toolbar">
              {[
                { label: 'Cut',   fn: handleCut },
                { label: 'Paste', fn: handlePaste },
                { label: 'Undo',  fn: handleUndo },
                { label: 'Redo',  fn: handleRedo },
              ].map(b => (
                <button key={b.label} onClick={b.fn} className="toolbar-btn">{b.label}</button>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, color: '#2a7a7a', fontSize: 13 }}>
                <button onClick={() => setWcVis(v => !v)}
                  style={{ background: 'none', border: 'none', color: '#2a7a7a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 'bold' }}>
                  <svg viewBox="0 0 24 16" style={{ width: 22, height: 14, fill: 'none', stroke: '#2a7a7a', strokeWidth: 1.8 }}>
                    <ellipse cx="12" cy="8" rx="11" ry="7" />
                    <circle cx="12" cy="8" r="3.5" fill="#2a7a7a" stroke="none" />
                  </svg>
                  {wcVis ? 'Hide Word Count' : 'Show Word Count'}
                </button>
                <span style={{ fontWeight: 'bold', fontSize: 14, color: '#333', minWidth: 20, visibility: wcVis ? 'visible' : 'hidden' }}>{wc}</span>
              </div>
            </div>

            <textarea ref={taRef} value={essay} onChange={handleInput}
              disabled={!started}
              placeholder={started ? '' : 'Press Start to begin your timed session.'}
              className="writing-textarea"
              style={{ cursor: started ? 'text' : 'not-allowed' }}
            />
          </div>
        </div>
      </div>

      {/* Loading overlay removed — card appears immediately on submit */}

      {/* Self-prediction overlay — shown after API returns, before results */}
      {showPrediction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'white', borderRadius: 10, padding: '1.5rem', maxWidth: 420, width: '100%' }}>
            <h2 style={{ color: '#2a7a7a', margin: '0 0 0.5rem 0', fontSize: 18 }}>How do you think you did?</h2>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 1.25rem 0' }}>Make a prediction before seeing your results.</p>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Expected score (out of 5)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setPrediction(p => ({ ...p, score: s }))}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: `1.5px solid ${prediction.score === s ? '#2a7a7a' : '#e5e7eb'}`, background: prediction.score === s ? '#2a7a7a' : '#fff', color: prediction.score === s ? '#fff' : '#374151', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Confidence</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Guessing', 'Somewhat confident', 'Confident', 'Very confident'].map(c => (
                  <button key={c} onClick={() => setPrediction(p => ({ ...p, confidence: c }))}
                    style={{ padding: '7px 10px', borderRadius: 6, border: `1.5px solid ${prediction.confidence === c ? '#2a7a7a' : '#e5e7eb'}`, background: prediction.confidence === c ? '#2a7a7a' : '#fff', color: prediction.confidence === c ? '#fff' : '#374151', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => { setResult(pendingResult); setShowPrediction(false) }}
              disabled={prediction.score === null || prediction.confidence === null}
              style={{ width: '100%', background: prediction.score !== null && prediction.confidence !== null ? '#2a7a7a' : '#9ca3af', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 0', fontSize: 15, fontWeight: 700, cursor: prediction.score !== null && prediction.confidence !== null ? 'pointer' : 'not-allowed' }}>
              See my results →
            </button>
          </div>
        </div>
      )}

      {/* Feedback card — shown immediately on submit (skeleton) then fills in */}
      {(loading || result) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 999, overflowY: 'auto', padding: '1rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 8, padding: '1.5rem', maxWidth: 650, width: '100%', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ color: '#2a7a7a', margin: 0 }}>Writing Feedback</h2>
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#2a7a7a', fontSize: 13 }}>
                  <div style={{ width: 14, height: 14, border: '2px solid #d1e8e8', borderTopColor: '#2a7a7a', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                  Evaluating…
                </div>
              )}
            </div>

            {/* Score */}
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div className="skel" style={{ width: 80, height: 56, borderRadius: 6 }} />
                  <div className="skel" style={{ width: 60, height: 14 }} />
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '3rem', fontWeight: 800, color: '#2a7a7a' }}>
                    {result!.score?.toFixed(1) ?? '—'}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>out of 5</div>
                </>
              )}
            </div>

            {/* Feedback */}
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ fontSize: '0.8rem', color: '#2a7a7a', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Feedback</h4>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="skel" style={{ width: '100%', height: 14 }} />
                  <div className="skel" style={{ width: '90%', height: 14 }} />
                  <div className="skel" style={{ width: '75%', height: 14 }} />
                </div>
              ) : (
                <p style={{ color: '#333', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{result!.feedback}</p>
              )}
            </div>

            {/* Strengths */}
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ fontSize: '0.8rem', color: '#2a7a7a', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Strengths</h4>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: '1.2rem' }}>
                  <div className="skel" style={{ width: '80%', height: 13 }} />
                  <div className="skel" style={{ width: '65%', height: 13 }} />
                </div>
              ) : result!.strengths.length > 0 ? (
                <ul style={{ paddingLeft: '1.2rem', color: '#333', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
                  {result!.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              ) : null}
            </div>

            {/* Improvements */}
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ fontSize: '0.8rem', color: '#2a7a7a', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Areas to Improve</h4>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: '1.2rem' }}>
                  <div className="skel" style={{ width: '85%', height: 13 }} />
                  <div className="skel" style={{ width: '70%', height: 13 }} />
                  <div className="skel" style={{ width: '60%', height: 13 }} />
                </div>
              ) : result!.improvements.length > 0 ? (
                <ul style={{ paddingLeft: '1.2rem', color: '#333', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
                  {result!.improvements.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              ) : null}
            </div>

            {/* Writing Analysis */}
            <div style={{ marginBottom: '1rem', padding: '10px 12px', background: '#f8fffe', border: '1px solid #d1e8e8', borderRadius: 6 }}>
              <h4 style={{ fontSize: '0.8rem', color: '#2a7a7a', textTransform: 'uppercase', marginBottom: '0.6rem', margin: '0 0 0.6rem 0' }}>Writing Analysis</h4>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {['Content', 'Syntax / Lexical', ...(taskType === 'Write an Email' ? ['Conventions'] : []), 'Accuracy'].map(dim => (
                    <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: '0.78rem', color: '#6b7280', width: 110, flexShrink: 0 }}>{dim}</span>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#e8e8e8', overflow: 'hidden' }}>
                        <div className="skel" style={{ width: '100%', height: '100%' }} />
                      </div>
                      <div className="skel" style={{ width: 28, height: 13, borderRadius: 3 }} />
                    </div>
                  ))}
                  <p style={{ fontSize: '0.75rem', color: '#9ca3af', margin: '4px 0 0 0' }}>Analysis runs alongside scoring…</p>
                </div>
              ) : (
                <p style={{ fontSize: '0.82rem', color: '#6b7280', margin: 0 }}>
                  Detailed NLP analysis saved.{' '}
                  <a href={`/dashboard/writing/sessions/${result!.practice_id}`} style={{ color: '#2a7a7a', fontWeight: 600 }}>View full session analysis →</a>
                </p>
              )}
            </div>

            {/* Polished version */}
            {!loading && result!.corrected_version && (
              <div style={{ marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.8rem', color: '#2a7a7a', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Polished Version</h4>
                <p style={{ color: '#333', fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{result!.corrected_version}</p>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {!loading && (
                <>
                  <button onClick={() => { setResult(null); setChecklist(null); setPendingResult(null); setShowPrediction(false); setPrediction({ score: null, confidence: null }); setEssay(''); essayRef.current = ''; setSec(customLimit); setStarted(false) }}
                    style={{ padding: '8px 20px', border: '1px solid #ccc', background: 'white', cursor: 'pointer', fontSize: 14, borderRadius: 3, color: '#333' }}>
                    Close
                  </button>
                  <button onClick={handleChecklist} disabled={checklistLoading}
                    style={{ padding: '8px 20px', border: '1px solid #2a7a7a', background: 'white', cursor: checklistLoading ? 'not-allowed' : 'pointer', fontSize: 14, borderRadius: 3, color: '#2a7a7a', fontWeight: 'bold' }}>
                    {checklistLoading ? 'Grading…' : '✅ Grade with Checklist'}
                  </button>
                  <button onClick={() => router.push(`/practice/writing/${type}`)}
                    style={{ background: '#2a7a7a', color: 'white', border: 'none', padding: '8px 20px', fontSize: 15, fontWeight: 'bold', cursor: 'pointer', borderRadius: 3 }}>
                    Try Another ›
                  </button>
                </>
              )}
            </div>

            {/* Checklist results */}
            {checklist && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e5e7eb', paddingTop: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem', flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ color: '#2a7a7a', fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>
                    Essay Checklist
                  </h3>
                  <span style={{
                    background: checklist.passed_count === checklist.total_count ? '#dcfce7' : '#fef9c3',
                    color: checklist.passed_count === checklist.total_count ? '#166534' : '#854d0e',
                    fontSize: '0.8rem', fontWeight: 700, padding: '2px 10px', borderRadius: 12,
                  }}>
                    {checklist.passed_count} / {checklist.total_count} passed
                  </span>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {checklist.results.map(item => (
                    <li key={item.item} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '6px 8px', borderRadius: 4,
                      background: item.passed ? '#f0fdf4' : '#fff1f2',
                      border: `1px solid ${item.passed ? '#bbf7d0' : '#fecdd3'}`,
                    }}>
                      <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{item.passed ? '✅' : '❌'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '0.82rem', color: '#374151' }}>{item.text}</span>
                        {item.note && (
                          <span style={{ display: 'block', fontSize: '0.76rem', color: item.passed ? '#166534' : '#be123c', marginTop: 2 }}>
                            {item.note}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {checklist.improvement_note && (
                  <div style={{ marginTop: '0.8rem', padding: '8px 12px', background: '#f0f9ff', borderRadius: 4, border: '1px solid #bae6fd' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0369a1' }}>Next time: </span>
                    <span style={{ fontSize: '0.82rem', color: '#0c4a6e' }}>{checklist.improvement_note}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function WritingTaskPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params)
  return <RequireAuth><WritingEditorContent type={type} /></RequireAuth>
}
