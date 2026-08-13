'use client'

import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

const TASKS = [
  { href: '/practice/speaking/listen-and-repeat', title: 'Listen & Repeat', desc: 'Repeat sentences accurately — ETS rubric scored' },
  { href: '/practice/speaking/interview',         title: 'Interview',        desc: 'Answer open-ended questions — fluency & grammar scored' },
]

function SpeakingHubContent() {
  return (
    <>
      <Topbar />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6 text-xs text-[#6b7280]">
          <Link href="/practice" className="hover:text-[#2a7a7a]">Practice</Link>
          <span>/</span>
          <span className="font-medium text-[#1f2937]">Speaking</span>
        </div>
        <h1 className="text-xl font-bold text-[#1f2937] mb-6">Speaking Practice</h1>
        <div className="flex flex-col gap-3">
          {TASKS.map(t => (
            <Link key={t.href} href={t.href}
              className="card p-5 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all">
              <div className="font-bold text-sm text-[#1f2937]">{t.title}</div>
              <div className="text-xs text-[#6b7280] mt-0.5">{t.desc}</div>
            </Link>
          ))}
        </div>
      </main>
    </>
  )
}

export default function SpeakingHubPage() {
  return <RequireAuth><SpeakingHubContent /></RequireAuth>
}
