'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

const META: Record<string, { title: string; taskType: string; desc: string }> = {
  email: {
    title:    'Write an Email',
    taskType: 'Write an Email',
    desc:     '7 minutes · 120-140 words · formal/informal email',
  },
  discussion: {
    title:    'Write for an Academic Discussion',
    taskType: 'Write for an Academic Discussion',
    desc:     '10 minutes · 120-150 words · academic post',
  },
}

interface RecommendedResp {
  task_id: number | null
  snippet: string
  reason: string
}

function WritingChoiceContent({ slug }: { slug: string }) {
  const meta = META[slug]
  const [rec, setRec] = useState<RecommendedResp | null>(null)

  useEffect(() => {
    if (!meta) return
    api.get<RecommendedResp>('/api/writing/recommended', { task_type: meta.taskType })
      .then(setRec)
      .catch(() => {})
  }, [meta])

  if (!meta) return <p className="p-6 text-red-500">Unknown writing type: {slug}</p>

  const recHref = rec?.task_id
    ? `/practice/writing/${slug}/go?task_id=${rec.task_id}`
    : `/practice/writing/${slug}/go`

  return (
    <>
      <Topbar />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6 text-xs text-[#6b7280]">
          <Link href="/practice/writing" className="hover:text-[#2a7a7a]">Writing</Link>
          <span>/</span>
          <span className="font-medium text-[#1f2937]">{meta.title}</span>
        </div>
        <h1 className="text-xl font-bold text-[#1f2937] mb-1">{meta.title}</h1>
        <p className="text-xs text-[#6b7280] mb-8">{meta.desc}</p>

        {/* Choice row — Recommended + Manual side by side */}
        <div className="flex gap-5 mb-6">
          {/* Recommended */}
          <Link href={recHref}
            className="flex-1 flex flex-col gap-3 rounded-xl p-7 no-underline text-[#333] transition-all"
            style={{ border: '2px solid #2c7873', background: '#eaf5f3' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#d9eeea' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#eaf5f3' }}>
            <span style={{ fontSize: '1.4rem' }}>⭐</span>
            <span style={{ display: 'inline-block', background: '#2c7873', color: 'white', borderRadius: 20, padding: '3px 12px', fontSize: '0.75rem', fontWeight: 700, width: 'fit-content' }}>
              Recommended
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1f2937' }}>Start Recommended Task</span>
            <span style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.5 }}>
              We picked the best task for you based on your practice history.
            </span>
            {rec?.snippet && (
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1f2937', fontFamily: "Georgia, 'Times New Roman', serif" }}>
                📝 {rec.snippet}…
              </span>
            )}
            {rec?.reason && (
              <span style={{ fontSize: '0.82rem', color: '#6b7280' }}>{rec.reason}</span>
            )}
          </Link>

          {/* Manual */}
          <Link href={`/practice/writing/${slug}/browse`}
            className="flex-1 flex flex-col gap-3 rounded-xl p-7 no-underline text-[#333] transition-all"
            style={{ border: '2px solid #e6e8eb', background: 'white' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2c7873' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e6e8eb' }}>
            <span style={{ fontSize: '1.4rem' }}>📄</span>
            <span style={{ display: 'inline-block', background: '#9ca3af', color: 'white', borderRadius: 20, padding: '3px 12px', fontSize: '0.75rem', fontWeight: 700, width: 'fit-content' }}>
              Manual
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1f2937' }}>Choose a Task</span>
            <span style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.5 }}>
              Browse all available tasks and pick one yourself.
            </span>
            <span style={{ fontSize: '0.88rem', color: '#555' }}>Full control over your practice session</span>
          </Link>
        </div>

        {/* Strategy guide link */}
        <Link href={`/practice/writing/${slug}/guide`}
          className="card p-4 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all block">
          <div className="font-bold text-sm text-[#1f2937]">Strategy Guide</div>
          <div className="text-xs text-[#6b7280] mt-0.5">Tips, templates, and scoring rubric</div>
        </Link>
      </main>
    </>
  )
}

export default function WritingChoicePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params)
  return <RequireAuth><WritingChoiceContent slug={type} /></RequireAuth>
}
