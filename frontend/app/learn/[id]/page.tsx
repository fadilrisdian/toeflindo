'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
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
  content: string
  has_lesson: number  // 0 or 1 from sqlite
}

type Tab = 'lesson' | 'raw'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 7, fontSize: '0.78rem',
        fontWeight: 600, cursor: 'pointer',
        border: '1px solid',
        borderColor: copied ? '#2a7a7a' : '#e6e8eb',
        background: copied ? '#eaf5f3' : 'white',
        color: copied ? '#2a7a7a' : '#6b7280',
        transition: 'all 0.15s',
      }}
    >
      {copied ? '✓ Copied' : '⎘ Copy'}
    </button>
  )
}

function TopicContent() {
  const params = useParams()
  const id = params?.id as string

  const [topic, setTopic] = useState<Topic | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('raw')
  const [lessonHtml, setLessonHtml] = useState('')
  const [lessonLoading, setLessonLoading] = useState(false)
  const [lessonError, setLessonError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [extraTopics, setExtraTopics] = useState<{ id: number; title: string; content: string }[]>([])
  const [addInput, setAddInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')

  const handleAdd = async () => {
    const tid = parseInt(addInput.trim(), 10)
    if (!tid || isNaN(tid)) { setAddError('Enter a valid ID'); return }
    if (tid === parseInt(id, 10)) { setAddError('Already shown'); return }
    if (extraTopics.find(e => e.id === tid)) { setAddError('Already added'); return }
    setAddLoading(true)
    setAddError('')
    try {
      const t = await api.get<Topic>(`/api/learn/topics/${tid}`)
      setExtraTopics(prev => [...prev, { id: t.id, title: t.title, content: t.content }])
      setAddInput('')
    } catch {
      setAddError(`Topic ${tid} not found`)
    } finally {
      setAddLoading(false)
    }
  }

  useEffect(() => {
    if (!id) return
    api.get<Topic>(`/api/learn/topics/${id}`)
      .then(t => {
        setTopic(t)
        // Default to lesson tab if lesson exists
        if (t.has_lesson) setTab('lesson')
      })
      .catch(() => setError('Topic not found.'))
      .finally(() => setLoading(false))
  }, [id])

  // Fetch lesson HTML when switching to lesson tab
  useEffect(() => {
    if (tab !== 'lesson' || !topic?.has_lesson || lessonHtml) return
    setLessonLoading(true)
    setLessonError('')
    api.getRaw(`/api/learn/topics/${id}/lesson`)
      .then(setLessonHtml)
      .catch(() => setLessonError('Failed to load lesson.'))
      .finally(() => setLessonLoading(false))
  }, [tab, topic, id, lessonHtml])

  if (loading) return (
    <>
      <Topbar />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1.5rem' }}>
        <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>
      </main>
    </>
  )

  if (error || !topic) return (
    <>
      <Topbar />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1.5rem' }}>
        <p style={{ color: '#dc2626', fontSize: '0.875rem' }}>{error || 'Not found.'}</p>
        <Link href="/learn" style={{ color: '#2a7a7a', fontSize: '0.85rem' }}>← Back to topics</Link>
      </main>
    </>
  )

  const prevId = topic.id > 1 ? topic.id - 1 : null
  const nextId = topic.id < 145 ? topic.id + 1 : null

  return (
    <>
      <Topbar />
      <main style={{ maxWidth: '100%', margin: '0 auto', padding: '1.5rem' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.25rem', fontSize: '0.78rem', color: '#6b7280' }}>
          <Link href="/" style={{ color: '#6b7280', textDecoration: 'none' }}>Home</Link>
          <span>/</span>
          <Link href="/learn" style={{ color: '#6b7280', textDecoration: 'none' }}>Learn</Link>
          <span>/</span>
          <span style={{ color: '#1f2937', fontWeight: 500 }}>Unit {topic.section}</span>
        </div>

        {/* Title card */}
        <div style={{
          background: 'white', border: '1px solid #e6e8eb',
          borderRadius: 12, padding: '20px 24px', marginBottom: '1.25rem',
          boxShadow: '0 1px 3px rgba(16,24,40,.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 8, flexShrink: 0,
              background: '#eaf5f3', color: '#2a7a7a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.9rem', fontWeight: 800,
            }}>
              {topic.section}
            </span>
            <div style={{ flex: 1 }}>
              <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1f2937' }}>
                {topic.title}
              </h1>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#9ca3af', marginTop: 2 }}>
                📘 English Grammar in Use · p. {topic.page_range}
              </p>
            </div>
            {!!topic.has_lesson && (
              <span style={{
                background: '#eaf5f3', color: '#2a7a7a',
                border: '1px solid #c0dedd',
                borderRadius: 999, padding: '3px 10px',
                fontSize: '0.72rem', fontWeight: 700,
                flexShrink: 0,
              }}>
                ✦ Interactive
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: '1rem' }}>
          {!!topic.has_lesson && (
            <button
              onClick={() => setTab('lesson')}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer', border: '1px solid',
                borderColor: tab === 'lesson' ? '#2a7a7a' : '#e6e8eb',
                background: tab === 'lesson' ? '#eaf5f3' : 'white',
                color: tab === 'lesson' ? '#2a7a7a' : '#6b7280',
                transition: 'all 0.15s',
              }}
            >
              ✦ Interactive Lesson
            </button>
          )}
          <button
            onClick={() => setTab('raw')}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: '0.82rem',
              fontWeight: 600, cursor: 'pointer', border: '1px solid',
              borderColor: tab === 'raw' ? '#2a7a7a' : '#e6e8eb',
              background: tab === 'raw' ? '#eaf5f3' : 'white',
              color: tab === 'raw' ? '#2a7a7a' : '#6b7280',
              transition: 'all 0.15s',
            }}
          >
            📄 Raw Content
          </button>
        </div>

        {/* Fullscreen lesson overlay */}
        {fullscreen && lessonHtml && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: '#f6f7f8', display: 'flex', flexDirection: 'column',
          }}>
            {/* Thin top bar */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.6rem 1.25rem', background: 'linear-gradient(135deg,#2c7873,#173f3b)',
              flexShrink: 0,
            }}>
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.82rem', fontWeight: 600 }}>
                ✦ Unit {topic.section} — {topic.title}
              </span>
              <button
                onClick={() => setFullscreen(false)}
                style={{
                  background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff', borderRadius: 8, padding: '0.35rem 0.9rem',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                ✕ Exit Fullscreen
              </button>
            </div>
            <iframe
              srcDoc={lessonHtml}
              style={{ flex: 1, border: 'none', display: 'block', width: '100%' }}
              title={`Interactive lesson: ${topic.title}`}
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        )}

        {/* Tab panels */}
        {tab === 'lesson' && (
          <div style={{
            background: 'white', border: '1px solid #e6e8eb',
            borderRadius: 12, overflow: 'hidden', marginBottom: '1.5rem',
            boxShadow: '0 1px 3px rgba(16,24,40,.04)',
            width: '100%', maxWidth: '100vw',
          }}>
            {lessonLoading && (
              <div style={{ padding: '2rem', color: '#6b7280', fontSize: '0.875rem' }}>
                Loading lesson…
              </div>
            )}
            {lessonError && (
              <div style={{ padding: '2rem', color: '#dc2626', fontSize: '0.875rem' }}>
                {lessonError}
              </div>
            )}
            {lessonHtml && !lessonLoading && (
              <div>
                {/* Preview strip */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '1rem 1.25rem', borderBottom: '1px solid #e6e8eb',
                  background: '#f6f7f8', gap: 12, flexWrap: 'wrap',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1f2937' }}>
                      ✦ Interactive Lesson — Unit {topic.section}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
                      Active practice with hints, feedback, and adaptive logic
                    </div>
                  </div>
                  <button
                    onClick={() => setFullscreen(true)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: 'linear-gradient(135deg,#2a7a7a,#1f5f59)',
                      color: 'white', border: 'none', borderRadius: 8,
                      padding: '0.5rem 1.25rem', fontSize: '0.85rem',
                      fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                      boxShadow: '0 1px 4px rgba(42,122,122,0.25)',
                    }}
                  >
                    ▶ Start Lesson
                  </button>
                </div>
                {/* Scrollable preview behind */}
                <iframe
                  srcDoc={lessonHtml}
                  style={{
                    width: '100%', border: 'none',
                    height: '60vh', minHeight: 400,
                    display: 'block', pointerEvents: 'none',
                    filter: 'opacity(0.45)',
                  }}
                  title={`Preview: ${topic.title}`}
                  sandbox="allow-scripts allow-same-origin"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <div style={{
                  position: 'relative', marginTop: -80, height: 80,
                  background: 'linear-gradient(to bottom, transparent, white)',
                  pointerEvents: 'none',
                }} />
              </div>
            )}
          </div>
        )}

        {tab === 'raw' && (
          <div style={{
            background: 'white', border: '1px solid #e6e8eb',
            borderRadius: 12, padding: '24px 28px', marginBottom: '1.5rem',
            boxShadow: '0 1px 3px rgba(16,24,40,.04)',
          }}>
            {/* Toolbar: Add ID + Copy */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
              <input
                type="number"
                min={1} max={145}
                value={addInput}
                onChange={e => { setAddInput(e.target.value); setAddError('') }}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="Add topic ID…"
                style={{
                  padding: '5px 10px', borderRadius: 7, fontSize: '0.82rem',
                  border: `1px solid ${addError ? '#dc2626' : '#e6e8eb'}`,
                  outline: 'none', width: 130, color: '#1f2937',
                }}
              />
              <button
                onClick={handleAdd}
                disabled={addLoading}
                style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: '0.78rem',
                  fontWeight: 600, cursor: addLoading ? 'not-allowed' : 'pointer',
                  border: '1px solid #2a7a7a',
                  background: '#eaf5f3', color: '#2a7a7a',
                  opacity: addLoading ? 0.6 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {addLoading ? '…' : '+ Add'}
              </button>
              {addError && (
                <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>{addError}</span>
              )}
              {/* Extra topic badges */}
              {extraTopics.map(e => (
                <span key={e.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: '#f3f4f6', border: '1px solid #e6e8eb',
                  borderRadius: 999, padding: '2px 8px', fontSize: '0.72rem',
                  color: '#374151', fontWeight: 600,
                }}>
                  #{e.id}
                  <button
                    onClick={() => setExtraTopics(prev => prev.filter(x => x.id !== e.id))}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#9ca3af', fontSize: '0.72rem', padding: 0, lineHeight: 1,
                    }}
                  >✕</button>
                </span>
              ))}
              <div style={{ marginLeft: 'auto' }}>
                <CopyButton text={[topic.content, ...extraTopics.map(e => e.content)].join('\n\n---\n\n')} />
              </div>
            </div>

            {/* Current topic content */}
            <pre style={{
              margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontFamily: 'inherit', fontSize: '0.855rem',
              lineHeight: 1.75, color: '#1f2937',
            }}>
              {topic.content}
            </pre>

            {/* Extra topics content */}
            {extraTopics.map(e => (
              <div key={e.id}>
                <div style={{
                  margin: '1.25rem 0 0.5rem',
                  borderTop: '1px dashed #e6e8eb',
                  paddingTop: '1rem',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{
                    background: '#eaf5f3', color: '#2a7a7a',
                    borderRadius: 999, padding: '2px 8px',
                    fontSize: '0.72rem', fontWeight: 700,
                  }}>#{e.id}</span>
                  <span style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>{e.title}</span>
                </div>
                <pre style={{
                  margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: 'inherit', fontSize: '0.855rem',
                  lineHeight: 1.75, color: '#1f2937',
                }}>
                  {e.content}
                </pre>
              </div>
            ))}
          </div>
        )}

        {/* Prev / Next nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          {prevId ? (
            <Link href={`/learn/${prevId}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0.5rem 1rem', borderRadius: 8,
                border: '1px solid #e6e8eb', background: 'white',
                fontSize: '0.82rem', color: '#2a7a7a', fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              ← Unit {prevId}
            </Link>
          ) : <div />}

          <Link href="/learn"
            style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '0.5rem 1rem', borderRadius: 8,
              border: '1px solid #e6e8eb', background: 'white',
              fontSize: '0.82rem', color: '#6b7280', fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            All Topics
          </Link>

          {nextId ? (
            <Link href={`/learn/${nextId}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0.5rem 1rem', borderRadius: 8,
                border: '1px solid #e6e8eb', background: 'white',
                fontSize: '0.82rem', color: '#2a7a7a', fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Unit {nextId} →
            </Link>
          ) : <div />}
        </div>

      </main>
    </>
  )
}

export default function TopicPage() {
  return <RequireAuth><TopicContent /></RequireAuth>
}
