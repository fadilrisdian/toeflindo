'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Task {
  task_id: number
  category: string | null
  task_type: string
  question: string
  tags: string | null
  answer: string | null
  source: string
  reference_only: number
  question_type: string | null
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

const EMPTY_FORM = {
  category: '',
  task_type: TASK_TYPES[0],
  question: '',
  tags: '',
  answer: '',
  source: 'https://www.toeflresources.com/',
  reference_only: 0,
  question_type: '',
}

const AUDIO_TYPES = ['Listen and Repeat', 'Take an Interview'] as const
type AudioTaskType = typeof AUDIO_TYPES[number]

function isAudioType(t: string): t is AudioTaskType {
  return (AUDIO_TYPES as readonly string[]).includes(t)
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Badge({ taskType }: { taskType: string }) {
  const c = TYPE_COLOR[taskType] ?? { bg: '#f1f2f4', color: '#6b7280' }
  return (
    <span style={{
      fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px',
      borderRadius: 10, background: c.bg, color: c.color,
      whiteSpace: 'nowrap',
    }}>
      {taskType}
    </span>
  )
}

function TaskForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: typeof EMPTY_FORM
  onSave: (data: typeof EMPTY_FORM, audioFile: File | null) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState(initial)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof EMPTY_FORM, v: string | number) =>
    setForm(f => ({ ...f, [k]: v }))

  const audio = isAudioType(form.task_type)
  // current path snippet shown when editing existing audio task
  const currentAudioName = initial.question
    ? initial.question.split('/').pop()
    : null

  const labelStyle: React.CSSProperties = {
    fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block',
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px',
    fontSize: '0.875rem', color: '#1f2937', outline: 'none', boxSizing: 'border-box',
    background: 'white',
  }
  const textareaStyle: React.CSSProperties = {
    ...inputStyle, resize: 'vertical', minHeight: 100, fontFamily: 'inherit',
  }

  const answerLabel = form.task_type === 'Listen and Repeat'
    ? 'Sentence text (displayed to learner) *'
    : form.task_type === 'Take an Interview'
      ? 'Interview topic / prompt text'
      : 'Answer / Model Answer'

  // clear audioFile when task type switches away from audio types
  const handleTypeChange = (v: string) => {
    set('task_type', v)
    if (!isAudioType(v)) setAudioFile(null)
  }

  const canSave = (() => {
    const hasAudio = !!(audioFile || initial.question)
    if (form.task_type === 'Listen and Repeat') {
      // needs audio file AND sentence text
      return hasAudio && !!(form.answer ?? '').trim()
    }
    if (form.task_type === 'Take an Interview') {
      // needs audio file only
      return hasAudio
    }
    return !!form.question.trim()
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Task Type */}
      <div>
        <label style={labelStyle}>Task Type *</label>
        <select value={form.task_type} onChange={e => handleTypeChange(e.target.value)}
          style={inputStyle}>
          {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Question / Audio */}
      {audio ? (
        <div>
          <label style={labelStyle}>Audio File *</label>
          <input
            ref={audioRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.wav,.ogg"
            style={{ display: 'none' }}
            onChange={e => setAudioFile(e.target.files?.[0] ?? null)}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => audioRef.current?.click()}
              style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 8, background: 'white', color: '#374151', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
              Choose audio file
            </button>
            {audioFile ? (
              <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600 }}>
                ✓ {audioFile.name}
              </span>
            ) : currentAudioName ? (
              <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                Current: <code style={{ background: '#f1f2f4', padding: '1px 5px', borderRadius: 4 }}>{currentAudioName}</code>
              </span>
            ) : (
              <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>No file chosen</span>
            )}
          </div>
          <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 6 }}>
            Accepted: .mp3, .m4a, .wav, .ogg — will be saved under speaking-practice/{form.task_type === 'Listen and Repeat' ? 'listen-and-repeat' : 'take-an-interview'}/uploads/
          </p>
        </div>
      ) : (
        <div>
          <label style={labelStyle}>Question / Prompt *</label>
          <textarea value={form.question} onChange={e => set('question', e.target.value)}
            style={textareaStyle} placeholder="Enter the task prompt or question…" />
        </div>
      )}

      {/* Answer */}
      <div>
        <label style={labelStyle}>{answerLabel}</label>
        <textarea value={form.answer ?? ''} onChange={e => set('answer', e.target.value)}
          style={{ ...textareaStyle, minHeight: 80 }}
          placeholder={
            form.task_type === 'Listen and Repeat'
              ? 'The exact sentence the learner will see…'
              : form.task_type === 'Take an Interview'
                ? 'Interview topic or prompt text (optional)…'
                : 'Expected answer or model response (optional)…'
          } />
      </div>

      {/* Tags */}
      <div>
        <label style={labelStyle}>Tags</label>
        <input type="text" value={form.tags ?? ''} onChange={e => set('tags', e.target.value)}
          style={inputStyle} placeholder="e.g. speaking,listen-repeat,campus-library" />
      </div>

      {/* Category + Question Type — row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Category</label>
          <input type="text" value={form.category ?? ''} onChange={e => set('category', e.target.value)}
            style={inputStyle} placeholder="e.g. Writing" />
        </div>
        <div>
          <label style={labelStyle}>Question Type</label>
          <input type="text" value={form.question_type ?? ''} onChange={e => set('question_type', e.target.value)}
            style={inputStyle} placeholder="e.g. integrated" />
        </div>
      </div>

      {/* Source + Reference Only — row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
        <div>
          <label style={labelStyle}>Source</label>
          <input type="text" value={form.source} onChange={e => set('source', e.target.value)}
            style={inputStyle} />
        </div>
        <div style={{ paddingBottom: 2 }}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.reference_only === 1}
              onChange={e => set('reference_only', e.target.checked ? 1 : 0)}
              style={{ width: 16, height: 16 }} />
            Reference only
          </label>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
        <button onClick={onCancel} disabled={saving}
          style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: '0.875rem', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
          Cancel
        </button>
        <button onClick={() => onSave(form, audioFile)} disabled={saving || !canSave}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: saving || !canSave ? '#9ca3af' : '#2a7a7a', color: 'white', fontSize: '0.875rem', fontWeight: 600, cursor: saving || !canSave ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

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

// ── CSV helpers ───────────────────────────────────────────────────────────────

const CSV_EXAMPLE = `task_type,question,answer,tags,category,question_type,source,reference_only
Build a Sentence,"She ___ to school every day.","goes","Build a Sentence,Group 1",,,https://www.toeflresources.com/,0
Write an Email,"Write an email to your professor about missing class.","Dear Professor...",,,email,https://www.toeflresources.com/,0
Listen and Repeat,/home/ubuntu/toeflindo/speaking-practice/listen-and-repeat/campus/lib1.mp3,"Welcome to the library.","speaking,listen-repeat,campus-library",,,https://www.toeflresources.com/,0
Take an Interview,/home/ubuntu/toeflindo/speaking-practice/take-an-interview/campus/tour.mp3,"Campus life and facilities","speaking,take-an-interview,campus",,,https://www.toeflresources.com/,0`

/** Minimal RFC-4180 CSV parser — returns headers + data rows as string[] arrays. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuote = false
  const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inQuote) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i++ }
        else inQuote = false
      } else { field += ch }
    } else {
      if (ch === '"') { inQuote = true }
      else if (ch === ',') { row.push(field.trim()); field = '' }
      else if (ch === '\n') {
        row.push(field.trim()); field = ''
        if (row.some(c => c !== '')) lines.push(row)
        row = []
      } else { field += ch }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(c => c !== '')) lines.push(row) }
  if (lines.length === 0) return { headers: [], rows: [] }
  return { headers: lines[0].map(h => h.toLowerCase()), rows: lines.slice(1) }
}

interface ParsedTask {
  task_type: string; question: string; answer: string | null
  tags: string | null; category: string | null; question_type: string | null
  source: string; reference_only: number
}

interface ParseResult { tasks: ParsedTask[]; errors: string[] }

function csvToTasks(text: string): ParseResult {
  const errors: string[] = []
  const tasks: ParsedTask[] = []
  if (!text.trim()) return { tasks, errors }

  const { headers, rows } = parseCsv(text)
  if (headers.length === 0) { errors.push('Empty or invalid CSV'); return { tasks, errors } }

  for (const col of ['task_type', 'question']) {
    if (!headers.includes(col)) errors.push(`Missing required column: "${col}"`)
  }
  if (errors.length) return { tasks, errors }

  const idx = (col: string) => headers.indexOf(col)
  rows.forEach((row, ri) => {
    const get = (col: string) => { const i = idx(col); return i >= 0 ? (row[i] ?? '') : '' }
    const lineNo = ri + 2
    const task_type = get('task_type').trim()
    const question  = get('question').trim()
    if (!task_type) { errors.push(`Row ${lineNo}: task_type is required`); return }
    if (!question)  { errors.push(`Row ${lineNo}: question is required`); return }
    if (!(TASK_TYPES as readonly string[]).includes(task_type)) {
      errors.push(`Row ${lineNo}: unknown task_type "${task_type}"`); return
    }
    // L&R: answer (sentence text) is required
    const answer = get('answer') || null
    if (task_type === 'Listen and Repeat' && !answer) {
      errors.push(`Row ${lineNo}: answer (sentence text) is required for Listen and Repeat`); return
    }
    tasks.push({
      task_type, question,
      answer,
      tags:          get('tags')          || null,
      category:      get('category')      || null,
      question_type: get('question_type') || null,
      source:        get('source')        || 'https://www.toeflresources.com/',
      reference_only: get('reference_only').trim() === '1' ? 1 : 0,
    })
  })
  return { tasks, errors }
}

// ── CSV Import Modal ───────────────────────────────────────────────────────────

function CsvImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csvText, setCsvText]       = useState('')
  const [importing, setImporting]   = useState(false)
  const [result, setResult]         = useState<{ inserted: number; errors: { row: number; error: string }[] } | null>(null)
  const [apiError, setApiError]     = useState('')
  const [showFormat, setShowFormat] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // derive parse result on every change — cheap enough inline
  const [parsed, setParsed] = useState<ParseResult>({ tasks: [], errors: [] })
  useEffect(() => { setParsed(csvToTasks(csvText)) }, [csvText])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCsvText((ev.target?.result as string) ?? '')
    reader.readAsText(file)
    // reset so same file can be re-loaded
    e.target.value = ''
  }

  async function handleImport() {
    if (parsed.tasks.length === 0) return
    setImporting(true); setApiError(''); setResult(null)
    try {
      const res = await api.post<{ inserted: number; errors: { row: number; error: string }[] }>(
        '/api/admin/tasks/bulk',
        { tasks: parsed.tasks },
      )
      setResult(res)
      if (res.errors.length === 0) { onDone(); onClose() }
    } catch (e: unknown) {
      setApiError(e instanceof Error ? e.message : 'Import failed')
    } finally { setImporting(false) }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px',
    fontSize: '0.875rem', color: '#1f2937', outline: 'none', boxSizing: 'border-box', background: 'white',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Format hint */}
      <div>
        <button onClick={() => setShowFormat(v => !v)}
          style={{ fontSize: '0.78rem', color: '#2a7a7a', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
          {showFormat ? '▾ Hide CSV format' : '▸ Show CSV format'}
        </button>
        {showFormat && (
          <div style={{ marginTop: 10, background: '#f8fafc', border: '1px solid #e6e8eb', borderRadius: 8, padding: '12px 14px' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>
              Columns — first row must be the header row:
            </p>
            <ul style={{ fontSize: '0.75rem', color: '#374151', margin: '0 0 10px', paddingLeft: 18, lineHeight: 1.8 }}>
              <li><code>task_type</code> <strong>(required)</strong> — one of: {TASK_TYPES.join(', ')}</li>
              <li>
                <code>question</code> <strong>(required)</strong> — for writing/grammar tasks: the prompt text.
                For <em>Listen and Repeat</em> / <em>Take an Interview</em>: the <strong>absolute path</strong> to the audio file already on the server
                (e.g. <code>/home/ubuntu/toeflindo/speaking-practice/listen-and-repeat/...</code>).
                Use the single-task form to upload new audio files.
              </li>
              <li><code>answer</code> — model answer. <strong>Required for Listen and Repeat</strong> (sentence text displayed to learner). Optional for others.</li>
              <li><code>tags</code> — comma-separated tags, e.g. <code>speaking,listen-repeat,campus-library</code></li>
              <li><code>category</code> — category label (optional)</li>
              <li><code>question_type</code> — e.g. <code>integrated</code> (optional)</li>
              <li><code>source</code> — URL, defaults to toeflresources.com</li>
              <li><code>reference_only</code> — <code>0</code> or <code>1</code>, defaults to <code>0</code></li>
            </ul>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>Example:</p>
            <pre style={{
              fontSize: '0.68rem', color: '#1f2937', background: '#f1f2f4',
              borderRadius: 6, padding: '8px 10px', overflowX: 'auto',
              margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>{CSV_EXAMPLE}</pre>
          </div>
        )}
      </div>

      {/* File upload */}
      <div>
        <label style={labelStyle}>Upload a .csv file</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()}
            style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 8, background: 'white', color: '#374151', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
            Choose file
          </button>
          {csvText && <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>Loaded — {csvText.split('\n').length} lines</span>}
        </div>
      </div>

      {/* Or paste */}
      <div>
        <label style={labelStyle}>Or paste CSV content</label>
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder={'task_type,question,answer,...\nBuild a Sentence,"She ___ every day.","goes",...'}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 120, fontFamily: 'monospace', fontSize: '0.78rem' }}
        />
      </div>

      {/* Parse preview */}
      {csvText.trim() && (
        <div style={{
          background: parsed.errors.length ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${parsed.errors.length ? '#fca5a5' : '#86efac'}`,
          borderRadius: 8, padding: '10px 14px',
        }}>
          {parsed.errors.length > 0 ? (
            <>
              <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#dc2626', margin: '0 0 6px' }}>
                ✕ {parsed.errors.length} parse error{parsed.errors.length !== 1 ? 's' : ''}
                {parsed.tasks.length > 0 ? ` — ${parsed.tasks.length} valid row${parsed.tasks.length !== 1 ? 's' : ''} found` : ''}
              </p>
              <ul style={{ fontSize: '0.75rem', color: '#dc2626', margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {parsed.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </>
          ) : (
            <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#16a34a', margin: 0 }}>
              ✓ {parsed.tasks.length} task{parsed.tasks.length !== 1 ? 's' : ''} ready to import
            </p>
          )}
        </div>
      )}

      {/* API error */}
      {apiError && (
        <div style={{ background: '#fdeaea', color: '#dc2626', borderRadius: 8, padding: '10px 14px', fontSize: '0.875rem' }}>
          {apiError}
        </div>
      )}

      {/* Partial success */}
      {result && result.errors.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 14px' }}>
          <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#c2410c', margin: '0 0 6px' }}>
            Inserted {result.inserted} task{result.inserted !== 1 ? 's' : ''} — {result.errors.length} DB error{result.errors.length !== 1 ? 's' : ''}
          </p>
          <ul style={{ fontSize: '0.75rem', color: '#c2410c', margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
        <button onClick={onClose} disabled={importing}
          style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: '0.875rem', fontWeight: 600, cursor: importing ? 'not-allowed' : 'pointer' }}>
          Cancel
        </button>
        <button
          onClick={handleImport}
          disabled={importing || parsed.tasks.length === 0}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: importing || parsed.tasks.length === 0 ? '#9ca3af' : '#2a7a7a',
            color: 'white', fontSize: '0.875rem', fontWeight: 600,
            cursor: importing || parsed.tasks.length === 0 ? 'not-allowed' : 'pointer',
          }}>
          {importing
            ? 'Importing…'
            : parsed.tasks.length > 0
              ? `Import ${parsed.tasks.length} task${parsed.tasks.length !== 1 ? 's' : ''}`
              : 'Import'}
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function PracticeContent() {
  const [rows, setRows]           = useState<Task[]>([])
  const [total, setTotal]         = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(true)
  const [filterType, setFilterType] = useState('')
  const [search, setSearch]       = useState('')
  const [searchInput, setSearchInput] = useState('')

  const [showAdd, setShowAdd]         = useState(false)
  const [showImport, setShowImport]   = useState(false)
  const [editTask, setEditTask]       = useState<Task | null>(null)
  const [deleteTask, setDeleteTask] = useState<Task | null>(null)
  const [saving, setSaving]       = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [error, setError]         = useState('')

  const load = useCallback(() => {
    setLoading(true)
    api.get<TasksResp>('/api/admin/tasks', {
      task_type: filterType || undefined,
      search: search || undefined,
      page,
      page_size: 25,
    }).then(d => {
      setRows(d.rows)
      setTotal(d.total)
      setTotalPages(d.total_pages)
    }).catch(() => setError('Failed to load tasks'))
      .finally(() => setLoading(false))
  }, [filterType, search, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [filterType, search])

  function handleSearch() {
    setSearch(searchInput)
    setPage(1)
  }

  async function uploadAudio(file: File, taskType: string): Promise<string> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('task_type', taskType)
    const res = await api.post<{ path: string }>('/api/admin/audio/upload', fd)
    return res.path
  }

  async function handleAdd(form: typeof EMPTY_FORM, audioFile: File | null) {
    setSaving(true); setError('')
    try {
      let question = form.question
      if (isAudioType(form.task_type) && audioFile) {
        question = await uploadAudio(audioFile, form.task_type)
      }
      await api.post('/api/admin/tasks', {
        ...form,
        question,
        category: form.category || null,
        tags: form.tags || null,
        answer: form.answer || null,
        question_type: form.question_type || null,
      })
      setShowAdd(false); load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create task')
    } finally { setSaving(false) }
  }

  async function handleEdit(form: typeof EMPTY_FORM, audioFile: File | null) {
    if (!editTask) return
    setSaving(true); setError('')
    try {
      let question = form.question
      if (isAudioType(form.task_type) && audioFile) {
        question = await uploadAudio(audioFile, form.task_type)
      }
      await api.put(`/api/admin/tasks/${editTask.task_id}`, {
        ...form,
        question,
        category: form.category || null,
        tags: form.tags || null,
        answer: form.answer || null,
        question_type: form.question_type || null,
      })
      setEditTask(null); load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update task')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteTask) return
    setDeleting(true); setError('')
    try {
      await api.delete(`/api/admin/tasks/${deleteTask.task_id}`)
      setDeleteTask(null); load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete task')
    } finally { setDeleting(false) }
  }

  function taskToForm(t: Task): typeof EMPTY_FORM {
    return {
      category: t.category ?? '',
      task_type: t.task_type,
      question: t.question,
      tags: t.tags ?? '',
      answer: t.answer ?? '',
      source: t.source,
      reference_only: t.reference_only,
      question_type: t.question_type ?? '',
    }
  }

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1rem' }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 16 }}>
          <Link href="/admin" style={{ color: '#6b7280', textDecoration: 'none' }}>← Admin</Link>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#1f2937', margin: 0 }}>
              📝 Practice Tasks
            </h1>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }}>
              {total} task{total !== 1 ? 's' : ''} in the bank
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setShowImport(true)}
              style={{ background: 'white', color: '#2a7a7a', border: '1px solid #2a7a7a', borderRadius: 8, padding: '9px 18px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
              ⬆ Import CSV
            </button>
            <button
              onClick={() => setShowAdd(true)}
              style={{ background: '#2a7a7a', color: 'white', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
              + Add Task
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#fdeaea', color: '#dc2626', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.875rem' }}>
            {error}
            <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: '0.875rem', color: '#1f2937', background: 'white', minWidth: 220 }}>
            <option value="">All types</option>
            {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 200 }}>
            <input
              type="text"
              placeholder="Search question or tags…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: '0.875rem', color: '#1f2937', outline: 'none' }}
            />
            <button
              onClick={handleSearch}
              style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
              Search
            </button>
            {(search || filterType) && (
              <button
                onClick={() => { setSearchInput(''); setSearch(''); setFilterType(''); setPage(1) }}
                style={{ padding: '8px 12px', background: 'none', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', color: '#6b7280', cursor: 'pointer' }}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Task list */}
        {loading ? (
          <p style={{ color: '#6b7280', padding: '2rem 0' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: '#9ca3af' }}>
            <p style={{ fontSize: '2rem', marginBottom: 8 }}>📭</p>
            <p>No tasks found.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map(task => (
              <div key={task.task_id}
                style={{ background: 'white', border: '1px solid #e6e8eb', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(16,24,40,.03)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                      <Badge taskType={task.task_type} />
                      {task.tags && (
                        <span style={{ fontSize: '0.65rem', color: '#6b7280', background: '#f1f2f4', padding: '2px 7px', borderRadius: 10 }}>
                          {task.tags}
                        </span>
                      )}
                      {task.reference_only === 1 && (
                        <span style={{ fontSize: '0.65rem', color: '#92400e', background: '#fef3c7', padding: '2px 7px', borderRadius: 10 }}>
                          ref only
                        </span>
                      )}
                      <span style={{ fontSize: '0.65rem', color: '#9ca3af', marginLeft: 'auto' }}>#{task.task_id}</span>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: '#1f2937', margin: 0, lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {task.question.length > 200
                        ? task.question.slice(0, 200) + '…'
                        : task.question}
                    </p>
                    {task.answer && (
                      <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 6, lineHeight: 1.4 }}>
                        <strong style={{ color: '#9ca3af' }}>Answer:</strong>{' '}
                        {task.answer.length > 120 ? task.answer.slice(0, 120) + '…' : task.answer}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => setEditTask(task)}
                      style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTask(task)}
                      style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: page === 1 ? '#f3f4f6' : 'white', color: page === 1 ? '#9ca3af' : '#374151', fontSize: '0.875rem', cursor: page === 1 ? 'not-allowed' : 'pointer' }}>
              ← Prev
            </button>
            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: page === totalPages ? '#f3f4f6' : 'white', color: page === totalPages ? '#9ca3af' : '#374151', fontSize: '0.875rem', cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>
              Next →
            </button>
          </div>
        )}
      </main>

      {/* Add modal */}
      {showAdd && (
        <Modal title="Add New Task" onClose={() => setShowAdd(false)}>
          <TaskForm
            initial={EMPTY_FORM}
            onSave={handleAdd}
            onCancel={() => setShowAdd(false)}
            saving={saving}
          />
        </Modal>
      )}

      {/* Import CSV modal */}
      {showImport && (
        <Modal title="Import Tasks from CSV" onClose={() => setShowImport(false)}>
          <CsvImportModal onClose={() => setShowImport(false)} onDone={load} />
        </Modal>
      )}

      {/* Edit modal */}
      {editTask && (
        <Modal title={`Edit Task #${editTask.task_id}`} onClose={() => setEditTask(null)}>
          <TaskForm
            initial={taskToForm(editTask)}
            onSave={handleEdit}
            onCancel={() => setEditTask(null)}
            saving={saving}
          />
        </Modal>
      )}

      {/* Delete confirm modal */}
      {deleteTask && (
        <Modal title="Delete Task" onClose={() => setDeleteTask(null)}>
          <p style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.6, marginBottom: 16 }}>
            Delete <strong>Task #{deleteTask.task_id}</strong>?
          </p>
          <div style={{ background: '#f9fafb', border: '1px solid #e6e8eb', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
            <Badge taskType={deleteTask.task_type} />
            <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 8, lineHeight: 1.5 }}>
              {deleteTask.question.slice(0, 160)}{deleteTask.question.length > 160 ? '…' : ''}
            </p>
          </div>
          <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: 20 }}>
            This cannot be undone. Practice logs referencing this task will remain.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setDeleteTask(null)} disabled={deleting}
              style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleDelete} disabled={deleting}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: deleting ? '#9ca3af' : '#dc2626', color: 'white', fontSize: '0.875rem', fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

export default function PracticePage() {
  return <RequireAuth><PracticeContent /></RequireAuth>
}
