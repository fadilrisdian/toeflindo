'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

const MODE_META: Record<string, { title: string; taskType: string; desc: string }> = {
  'listen-and-repeat': {
    title: 'Listen & Repeat',
    taskType: 'Listen and Repeat',
    desc: 'Hear each sentence once, then repeat it exactly — ETS rubric scored.',
  },
  'interview': {
    title: 'Interview',
    taskType: 'Take an Interview',
    desc: 'Answer open-ended questions about familiar topics — fluency & grammar scored.',
  },
}

interface RecResp { task_id: number | null; tags: string | null; snippet: string; reason: string }

function SpeakingModeContent({ mode }: { mode: string }) {
  const meta = MODE_META[mode]
  const [rec, setRec] = useState<RecResp | null>(null)

  useEffect(() => {
    if (!meta) return
    api.get<RecResp>('/api/speaking/recommended', { task_type: meta.taskType })
      .then(setRec).catch(() => {})
  }, [meta])

  if (!meta) return <p className="p-6 text-red-500">Unknown mode: {mode}</p>

  // Prefer tags-scoped link so practice stays within the topic, not all 100+ tasks
  const recHref = rec?.tags
    ? `/practice/speaking/${mode}/go?tags=${encodeURIComponent(rec.tags)}`
    : rec?.task_id
      ? `/practice/speaking/${mode}/go?task_id=${rec.task_id}`
      : `/practice/speaking/${mode}/go`

  return (
    <>
      <Topbar />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6 text-xs text-[#6b7280]">
          <Link href="/practice/speaking" className="hover:text-[#2a7a7a]">Speaking</Link>
          <span>/</span>
          <span className="font-medium text-[#1f2937]">{meta.title}</span>
        </div>
        <h1 className="text-xl font-bold text-[#1f2937] mb-1">{meta.title}</h1>
        <p className="text-sm text-[#6b7280] mb-8">{meta.desc}</p>

        {/* Recommended + Manual cards */}
        <div className="flex gap-5 mb-6">
          <Link href={recHref}
            className="flex-1 flex flex-col gap-3 rounded-xl p-7 no-underline text-[#333] transition-all"
            style={{ border: '2px solid #2c7873', background: '#eaf5f3' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#d9eeea' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#eaf5f3' }}>
            <span style={{ fontSize: '1.4rem' }}>⭐</span>
            <span style={{ display: 'inline-block', background: '#2c7873', color: 'white', borderRadius: 20, padding: '3px 12px', fontSize: '0.75rem', fontWeight: 700, width: 'fit-content' }}>
              Recommended
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1f2937' }}>Start Recommended Topic</span>
            <span style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.5 }}>
              We picked the best topic for you based on your practice history.
            </span>
            {rec?.snippet && (
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1f2937', fontFamily: "Georgia, 'Times New Roman', serif" }}>
                🎙 {rec.snippet}
              </span>
            )}
            {rec?.reason && (
              <span style={{ fontSize: '0.82rem', color: '#6b7280' }}>{rec.reason}</span>
            )}
          </Link>

          <Link href={`/practice/speaking/${mode}/topics`}
            className="flex-1 flex flex-col gap-3 rounded-xl p-7 no-underline text-[#333] transition-all"
            style={{ border: '2px solid #e6e8eb', background: 'white' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2c7873' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e6e8eb' }}>
            <span style={{ fontSize: '1.4rem' }}>📄</span>
            <span style={{ display: 'inline-block', background: '#9ca3af', color: 'white', borderRadius: 20, padding: '3px 12px', fontSize: '0.75rem', fontWeight: 700, width: 'fit-content' }}>
              Manual
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1f2937' }}>Choose a Topic</span>
            <span style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.5 }}>
              Browse all available topics and pick one yourself.
            </span>
            <span style={{ fontSize: '0.88rem', color: '#555' }}>Full control over your practice session</span>
          </Link>
        </div>
      </main>
    </>
  )
}

export default function SpeakingModePage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = use(params)
  return <RequireAuth><SpeakingModeContent mode={mode} /></RequireAuth>
}
