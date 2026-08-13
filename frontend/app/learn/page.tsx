'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

interface Topic {
  id: number
  section: number
  title: string
  page: number
  page_range: string
  has_lesson: number  // 0 or 1
}

// ── Insert HTML Modal ─────────────────────────────────────────────────────────
function InsertHtmlModal({ onClose }: { onClose: () => void }) {
  const [topicId, setTopicId] = useState('')
  const [html, setHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleSave() {
    const id = parseInt(topicId.trim(), 10)
    if (!id || isNaN(id) || id < 1 || id > 145) {
      setStatus({ ok: false, msg: 'Enter a valid topic ID (1–145)' })
      return
    }
    if (!html.trim()) {
      setStatus({ ok: false, msg: 'HTML content is required' })
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      await api.put(`/api/learn/topics/${id}/lesson`, { html })
      setStatus({ ok: true, msg: `Topic ${id} lesson saved successfully.` })
      setHtml('')
      setTopicId('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed'
      setStatus({ ok: false, msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Insert Lesson HTML"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(20,30,30,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div style={{
        background: 'white', borderRadius: 14,
        border: '1px solid #e6e8eb',
        boxShadow: '0 8px 40px rgba(20,30,30,0.18)',
        width: '100%', maxWidth: 780,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #e6e8eb',
          background: '#f6f7f8',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 6,
              background: '#eaf5f3', color: '#2a7a7a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.8rem',
            }}>✦</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1f2937' }}>
                Insert Lesson HTML
              </div>
              <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 1 }}>
                Paste generated HTML — creates or replaces the interactive lesson
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: '1.2rem', lineHeight: 1,
              padding: '4px 8px', borderRadius: 6,
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ID field */}
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
              Topic ID (1–145)
            </label>
            <input
              type="number"
              min={1} max={145}
              value={topicId}
              onChange={e => { setTopicId(e.target.value); setStatus(null) }}
              placeholder="e.g. 12"
              style={{
                padding: '7px 10px', borderRadius: 7, fontSize: '0.85rem',
                border: '1px solid #e6e8eb', outline: 'none',
                width: 120, color: '#1f2937',
              }}
            />
          </div>

          {/* HTML textarea */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
              Raw HTML Content
            </label>
            <textarea
              value={html}
              onChange={e => { setHtml(e.target.value); setStatus(null) }}
              placeholder="Paste the full HTML here…"
              spellCheck={false}
              style={{
                flex: 1, minHeight: 340,
                width: '100%', boxSizing: 'border-box',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.78rem', lineHeight: 1.6,
                color: '#1f2937', background: '#f6f7f8',
                border: '1px solid #e6e8eb', borderRadius: 8,
                padding: '0.75rem 1rem', resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>

          {/* Status */}
          {status && (
            <div style={{
              fontSize: '0.78rem', fontWeight: 600,
              color: status.ok ? '#16a34a' : '#dc2626',
              padding: '6px 10px', borderRadius: 7,
              background: status.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${status.ok ? '#bbf7d0' : '#fecaca'}`,
            }}>
              {status.ok ? '✓ ' : '✕ '}{status.msg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0.85rem 1.25rem',
          borderTop: '1px solid #e6e8eb',
          background: '#f6f7f8',
          flexShrink: 0,
        }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: saving ? '#9ca3af' : 'linear-gradient(135deg,#2a7a7a,#1f5f59)',
              color: 'white', border: 'none', borderRadius: 8,
              padding: '0.45rem 1.1rem', fontSize: '0.82rem',
              fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.2s',
            }}
          >
            {saving ? '…Saving' : '✦ Save Lesson'}
          </button>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #e6e8eb',
              color: '#6b7280', borderRadius: 8,
              padding: '0.45rem 1.1rem', fontSize: '0.82rem',
              fontWeight: 500, cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Prompt Modal ──────────────────────────────────────────────────────────────
function PromptModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyId, setCopyId] = useState('')
  const [copyStatus, setCopyStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.getRaw('/api/learn/lesson-prompt')
      .then(t => setText(t))
      .catch(() => setText('Failed to load prompt.'))
      .finally(() => setLoading(false))
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleCopy() {
    let payload = text
    const id = parseInt(copyId.trim(), 10)
    if (copyId.trim()) {
      if (isNaN(id) || id < 1 || id > 145) {
        setCopyStatus({ ok: false, msg: 'Invalid ID (1–145)' })
        return
      }
      setCopyStatus(null)
      try {
        const topic = await api.get<{ content: string }>(`/api/learn/topics/${id}`)
        payload = `${text}\n\n---\n\n${topic.content ?? ''}`
      } catch {
        setCopyStatus({ ok: false, msg: `Failed to fetch topic ${id}` })
        return
      }
    }
    navigator.clipboard.writeText(payload).then(() => {
      setCopied(true)
      setCopyStatus(copyId.trim() ? { ok: true, msg: `Copied prompt + topic ${id}` } : null)
      setTimeout(() => { setCopied(false); setCopyStatus(null) }, 2500)
    })
  }

  function handleEdit() {
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  function handleDoneEdit() {
    setEditing(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Grammar Lesson Prompt"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(20,30,30,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div style={{
        background: 'white', borderRadius: 14,
        border: '1px solid #e6e8eb',
        boxShadow: '0 8px 40px rgba(20,30,30,0.18)',
        width: '100%', maxWidth: 780,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Modal header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #e6e8eb',
          background: '#f6f7f8',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 6,
              background: '#eaf5f3', color: '#2a7a7a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.8rem',
            }}>📋</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1f2937' }}>
                Grammar Lesson Prompt
              </div>
              <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 1 }}>
                Paste this into an LLM with a chapter at the bottom
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: '1.2rem', lineHeight: 1,
              padding: '4px 8px', borderRadius: 6,
            }}
          >×</button>
        </div>

        {/* Prompt body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.25rem' }}>
          {loading ? (
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>
          ) : editing ? (
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box',
                minHeight: 420, height: '100%',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.8rem', lineHeight: 1.65,
                color: '#1f2937', background: '#f6f7f8',
                border: '1px solid #2a7a7a', borderRadius: 8,
                padding: '0.85rem 1rem', resize: 'vertical',
                outline: 'none',
              }}
            />
          ) : (
            <pre style={{
              margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.8rem', lineHeight: 1.65,
              color: '#1f2937', background: '#f6f7f8',
              border: '1px solid #e6e8eb', borderRadius: 8,
              padding: '0.85rem 1rem',
            }}>
              {text}
            </pre>
          )}
        </div>

        {/* Action footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0.85rem 1.25rem',
          borderTop: '1px solid #e6e8eb',
          background: '#f6f7f8',
          flexShrink: 0,
        }}>
          {editing ? (
            <button
              onClick={handleDoneEdit}
              style={{
                background: 'linear-gradient(135deg,#2a7a7a,#1f5f59)',
                color: 'white', border: 'none', borderRadius: 8,
                padding: '0.45rem 1.1rem', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              ✓ Done Editing
            </button>
          ) : (
            <button
              onClick={handleEdit}
              style={{
                background: 'white', color: '#1f2937',
                border: '1px solid #e6e8eb', borderRadius: 8,
                padding: '0.45rem 1.1rem', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              ✏️ Edit
            </button>
          )}

          {/* ID input + Copy */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={1} max={145}
              value={copyId}
              onChange={e => { setCopyId(e.target.value); setCopyStatus(null) }}
              placeholder="ID"
              title="Enter topic ID to append its raw content"
              style={{
                width: 64, padding: '0.4rem 0.5rem',
                borderRadius: 7, fontSize: '0.82rem',
                border: '1px solid #e6e8eb', outline: 'none',
                color: '#1f2937', textAlign: 'center',
              }}
            />
            <button
              onClick={handleCopy}
              style={{
                background: copied
                  ? 'linear-gradient(135deg,#16a34a,#15803d)'
                  : 'linear-gradient(135deg,#2a7a7a,#1f5f59)',
                color: 'white', border: 'none', borderRadius: 8,
                padding: '0.45rem 1.1rem', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'background 0.2s',
              }}
            >
              {copied ? '✓ Copied!' : '⎘ Copy'}
            </button>
          </div>

          {/* inline status */}
          {copyStatus && (
            <span style={{
              fontSize: '0.75rem', fontWeight: 600,
              color: copyStatus.ok ? '#16a34a' : '#dc2626',
            }}>
              {copyStatus.ok ? '✓ ' : '✕ '}{copyStatus.msg}
            </span>
          )}

          <span style={{ flex: 1 }} />

          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #e6e8eb',
              color: '#6b7280', borderRadius: 8,
              padding: '0.45rem 1.1rem', fontSize: '0.82rem',
              fontWeight: 500, cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
function LearnContent() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [showInsertHtml, setShowInsertHtml] = useState(false)

  useEffect(() => {
    api.get<Topic[]>('/api/learn/topics')
      .then(setTopics)
      .catch(() => setTopics([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = topics.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    String(t.section).includes(search)
  )

  return (
    <>
      <Topbar />
      {showPrompt && <PromptModal onClose={() => setShowPrompt(false)} />}
      {showInsertHtml && <InsertHtmlModal onClose={() => setShowInsertHtml(false)} />}

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Header */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: '0.78rem', color: '#6b7280' }}>
            <Link href="/" style={{ color: '#6b7280', textDecoration: 'none' }}>Home</Link>
            <span>/</span>
            <span style={{ color: '#1f2937', fontWeight: 500 }}>Learn</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1f2937', margin: 0 }}>
                📘 Murphy Grammar
              </h1>
              <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 4, marginBottom: 0 }}>
                145 units from English Grammar in Use — read exercises and study each topic.
              </p>
            </div>

            <button
              onClick={() => setShowPrompt(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'linear-gradient(135deg,#2a7a7a,#1f5f59)',
                color: 'white', border: 'none', borderRadius: 8,
                padding: '0.5rem 1.1rem', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                boxShadow: '0 1px 3px rgba(42,122,122,0.2)',
              }}
            >
              📋 Prompt
            </button>
            <button
              onClick={() => setShowInsertHtml(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'white',
                color: '#2a7a7a', border: '1px solid #2a7a7a', borderRadius: 8,
                padding: '0.5rem 1.1rem', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer', flexShrink: 0,
              }}
            >
              ✦ Insert HTML
            </button>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search topics…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '0.55rem 1rem', fontSize: '0.875rem',
            border: '1px solid #e6e8eb', borderRadius: 8,
            outline: 'none', marginBottom: '1.25rem',
            background: 'white',
          }}
        />

        {loading ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
            {filtered.map(t => (
              <Link key={t.id} href={`/learn/${t.id}`}
                style={{
                  display: 'block', textDecoration: 'none',
                  background: 'white', border: '1px solid #e6e8eb',
                  borderRadius: 10, padding: '14px 16px',
                  boxShadow: '0 1px 3px rgba(16,24,40,.04)',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#2a7a7a'
                  ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(42,122,122,0.12)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#e6e8eb'
                  ;(e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(16,24,40,.04)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{
                    flexShrink: 0, width: 28, height: 28, borderRadius: 6,
                    background: '#eaf5f3', color: '#2a7a7a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.7rem', fontWeight: 700,
                  }}>
                    {t.section}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '0.83rem', fontWeight: 600, color: '#1f2937', lineHeight: 1.35 }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: '0.73rem', color: '#9ca3af', marginTop: 2 }}>
                      p. {t.page_range}
                    </div>
                  </div>
                  <span style={{
                    flexShrink: 0,
                    fontSize: '0.65rem', fontWeight: 700,
                    padding: '2px 6px', borderRadius: 20,
                    background: t.has_lesson ? '#eaf5f3' : '#f3f4f6',
                    color: t.has_lesson ? '#2a7a7a' : '#9ca3af',
                    border: `1px solid ${t.has_lesson ? '#a7d8d2' : '#e5e7eb'}`,
                    lineHeight: 1.6,
                    alignSelf: 'flex-start',
                  }}>
                    {t.has_lesson ? '✦ HTML' : 'No HTML'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>No topics match your search.</p>
        )}
      </main>
    </>
  )
}

export default function LearnPage() {
  return <RequireAuth><LearnContent /></RequireAuth>
}
