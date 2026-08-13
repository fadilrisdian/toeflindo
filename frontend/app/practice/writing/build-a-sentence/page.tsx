'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

interface GroupRow { tags: string; first_task_id: number }

// Strip "Build a Sentence, " prefix to get the display name
function groupName(tags: string) {
  return tags.replace(/^Build a Sentence,\s*/i, '')
}

// Categorise by keywords in the display name
function categorise(name: string): string {
  if (/Practice Test/i.test(name)) return 'Practice Tests'
  if (/2026|Tutor|Tatiana|YouTube/i.test(name)) return 'TOEFL 2026 Writing'
  return 'Topic Practice'
}

const CATEGORY_ORDER = ['Practice Tests', 'TOEFL 2026 Writing', 'Topic Practice']

function BasHubContent() {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [loading, setLoad]  = useState(true)

  useEffect(() => {
    api.get<GroupRow[]>('/api/task/bank/groups', { task_type: 'Build a Sentence' })
      .then(rows => setGroups(rows))
      .finally(() => setLoad(false))
  }, [])

  // Group rows by category
  const byCategory: Record<string, GroupRow[]> = {}
  for (const row of groups) {
    const cat = categorise(groupName(row.tags))
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(row)
  }

  return (
    <>
      <Topbar />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6 text-xs text-[#6b7280]">
          <Link href="/practice/writing" className="hover:text-[#2a7a7a]">Writing</Link>
          <span>/</span>
          <span className="font-medium text-[#1f2937]">Build a Sentence</span>
        </div>
        <h1 className="text-xl font-bold text-[#1f2937] mb-1">Build a Sentence</h1>
        <p className="text-xs text-[#6b7280] mb-8">
          Question 1 of 3 · 5 min 50 sec · 10 sentences per group
        </p>

        {/* Strategy guide */}
        <Link href="/practice/writing/build-a-sentence/guide"
          className="card p-4 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all block mb-8">
          <div className="font-bold text-sm text-[#1f2937]">📖 Strategy Guide</div>
          <div className="text-xs text-[#6b7280] mt-0.5">7 sentence structures · examples · word bank tips</div>
        </Link>

        {loading && <p className="text-sm text-[#6b7280]">Loading groups…</p>}

        {/* Group sections */}
        {CATEGORY_ORDER.map(cat => {
          const rows = byCategory[cat]
          if (!rows?.length) return null
          return (
            <div key={cat} className="mb-8">
              <h2 className="text-xs font-bold text-[#9ca3af] uppercase tracking-widest mb-3">
                {cat}
              </h2>
              <div className="flex flex-col gap-2">
                {rows.map(row => {
                  const name = groupName(row.tags)
                  return (
                    <Link
                      key={row.tags}
                      href={`/practice/writing/build-a-sentence/go?group=${encodeURIComponent(name)}`}
                      className="card p-4 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm text-[#1f2937]">{name}</div>
                        <div className="text-xs text-[#6b7280] mt-0.5">10 sentences · 5 min 50 sec</div>
                      </div>
                      <span className="text-[#2a7a7a] text-lg">›</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </main>
    </>
  )
}

export default function BuildASentenceHubPage() {
  return <RequireAuth><BasHubContent /></RequireAuth>
}
