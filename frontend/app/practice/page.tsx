'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

// ── Mic Test ──────────────────────────────────────────────────────────────────

function MicTest() {
  const [status, setStatus]   = useState('Ready')
  const [statusColor, setColor] = useState('#6b7280')
  const [recording, setRec]   = useState(false)
  const [blobUrl, setBlobUrl] = useState('')

  const recRef    = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  async function startMicTest() {
    setBlobUrl('')
    setStatus('Requesting mic…')
    setColor('#b45309')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      recRef.current = mr
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setBlobUrl(prev => {
          if (prev) URL.revokeObjectURL(prev)
          return URL.createObjectURL(blob)
        })
        setStatus('Done — press ▶ to play back')
        setColor('#16a34a')
        setRec(false)
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      mr.start()
      setStatus('🔴 Recording…')
      setColor('#dc2626')
      setRec(true)
    } catch (e: unknown) {
      setStatus(`Mic error: ${e instanceof Error ? e.message : String(e)}`)
      setColor('#dc2626')
    }
  }

  function stopMicTest() {
    if (recRef.current && recRef.current.state === 'recording') recRef.current.stop()
  }

  return (
    <div style={{ maxWidth: 580, margin: '32px auto 0', border: '1px solid #e6e8eb', borderRadius: 12, background: 'white', padding: '24px 28px', boxShadow: '0 1px 3px rgba(16,24,40,.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: '1.3rem' }}>🎙️</span>
        <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1f2937' }}>Mic Test</span>
        <span style={{ fontSize: '.8rem', color: statusColor, marginLeft: 4 }}>{status}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={startMicTest} disabled={recording}
          style={{ background: recording ? '#e5e7eb' : '#2c7873', color: recording ? '#9ca3af' : 'white', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: '.88rem', fontWeight: 600, cursor: recording ? 'not-allowed' : 'pointer' }}>
          ● Record
        </button>
        <button onClick={stopMicTest} disabled={!recording}
          style={{ background: recording ? '#dc2626' : '#e5e7eb', color: recording ? 'white' : '#9ca3af', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: '.88rem', fontWeight: 600, cursor: recording ? 'pointer' : 'not-allowed' }}>
          ■ Stop
        </button>
        {blobUrl && (
          <audio controls src={blobUrl} style={{ display: 'block', height: 36, flex: 1, minWidth: 180 }} />
        )}
      </div>
    </div>
  )
}

// ── Practice Hub ──────────────────────────────────────────────────────────────

function PracticeHubContent() {
  const SECTIONS = [
    {
      href: null,
      icon: '📖',
      iconBg: '#e8f5e9', iconColor: '#2e7d32',
      title: 'Reading',
      desc: 'Read academic passages and answer comprehension questions.',
      meta: '35 minutes · 20 questions',
      soon: true,
    },
    {
      href: null,
      icon: '🎧',
      iconBg: '#fff3e0', iconColor: '#e65100',
      title: 'Listening',
      desc: 'Listen to lectures and conversations, then answer questions.',
      meta: '36 minutes · 28 questions',
      soon: true,
    },
    {
      href: '/practice/speaking',
      icon: '🎙️',
      iconBg: '#fce4ec', iconColor: '#c62828',
      title: 'Speaking',
      desc: 'Respond to prompts by speaking about familiar topics and academic content.',
      meta: '16 minutes · 4 tasks',
      soon: false,
    },
    {
      href: '/practice/writing',
      icon: '✍️',
      iconBg: '#e0f2f1', iconColor: '#2a7a7a',
      title: 'Writing',
      desc: 'Write emails and contribute to academic discussions with AI feedback.',
      meta: '29 minutes · 2 tasks',
      soon: false,
    },
    {
      href: '/practice/grammar',
      icon: '⚙️',
      iconBg: '#e8f0fe', iconColor: '#1a56c4',
      title: 'Grammar',
      desc: 'AI-generated weak spot drills and mistake review based on your logged mistakes.',
      meta: 'Weak Spot Drill',
      soon: false,
    },
    {
      href: '/practice/speaking/mistakes',
      icon: '🎙️',
      iconBg: '#f3e5f5', iconColor: '#7b1fa2',
      title: 'Speaking Mistakes',
      desc: 'Browse grammar mistakes from your speaking sessions.',
      meta: 'Filtered mistakes',
      soon: false,
    },
    {
      href: '/practice/grammar/free-text',
      icon: '📝',
      iconBg: '#fef9c3', iconColor: '#a16207',
      title: 'Free Text',
      desc: 'Paste any text and get instant grammar feedback. Mistakes are saved to your log.',
      meta: 'AI grammar analysis',
      soon: false,
    },
    {
      href: '/practice/writing/analysis',
      icon: '📊',
      iconBg: '#ede9fe', iconColor: '#6d28d9',
      title: 'Writing Analysis',
      desc: 'Practice the three dimensions that drive your writing score — syntax, vocabulary, and conventions.',
      meta: 'Syntax · Vocabulary · Conventions',
      soon: false,
    },
  ]

  return (
    <>
      <Topbar />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-2">TOEFL iBT Practice</h1>
          <p className="text-sm text-[#6b7280]">Choose a section to start practicing.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
          {SECTIONS.map(s => {
            const inner = (
              <>
                {s.soon && (
                  <span style={{ position: 'absolute', top: 10, right: 10, background: '#f1f2f4', color: '#9ca3af', fontSize: '0.65rem', fontWeight: 600, padding: '3px 8px', borderRadius: 12, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    Coming Soon
                  </span>
                )}
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: s.iconBg, color: s.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: '1.4rem' }}>
                  {s.icon}
                </div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 6, color: '#1f2937' }}>
                  {s.title}
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.4, marginBottom: 8 }}>{s.desc}</p>
                <span style={{ fontSize: '0.78rem', color: '#2c7873', fontWeight: 600 }}>{s.meta}</span>
              </>
            )

            const cardStyle: React.CSSProperties = {
              position: 'relative', background: 'white', border: '1px solid #e6e8eb',
              borderRadius: 12, padding: '28px 22px', textAlign: 'center',
              textDecoration: 'none', color: '#1f2937',
              boxShadow: '0 1px 3px rgba(16,24,40,.04)',
              opacity: s.soon ? 0.55 : 1,
              display: 'block',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }

            if (s.soon || !s.href) {
              return <div key={s.title} style={cardStyle}>{inner}</div>
            }
            return (
              <Link key={s.title} href={s.href}
                style={cardStyle}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a7a7a'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(42,122,122,0.12)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e6e8eb'; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(16,24,40,.04)' }}>
                {inner}
              </Link>
            )
          })}
        </div>

        <MicTest />
      </main>
    </>
  )
}

export default function PracticePage() {
  return <RequireAuth><PracticeHubContent /></RequireAuth>
}
