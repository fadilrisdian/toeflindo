'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

interface Recommendations {
  top_categories: { category: string; total_recurrences: number }[]
  total_mistakes: number
}

interface SRSDue { count: number }

interface RemediationQueue {
  pending: number
  first_id: number | null
}

function GrammarLandingContent() {
  const router = useRouter()
  const [recHref, setRecHref]     = useState<string | null>(null)
  const [recLabel, setRecLabel]   = useState<string>('Loading…')
  const [recSub, setRecSub]       = useState<string>('')
  const [remQueue, setRemQueue]   = useState<RemediationQueue | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<SRSDue>('/api/grammar/srs/due-count').catch(() => ({ count: 0 })),
      api.get<Recommendations>('/api/grammar/recommendations').catch(() => ({ top_categories: [], total_mistakes: 0 })),
      api.get<RemediationQueue>('/api/grammar/remediation-queue').catch(() => null),
    ]).then(([srs, rec, rem]) => {
      setRemQueue(rem)
      if (srs.count > 0) {
        setRecHref('/practice/grammar/srs')
        setRecLabel(`Spaced Review — ${srs.count} due today`)
        setRecSub('Keep your review streak going')
      } else if (rec.top_categories[0]) {
        const top = rec.top_categories[0]
        setRecHref(`/practice/grammar/weakspot?category=${encodeURIComponent(top.category)}`)
        setRecLabel(`Drill: ${top.category}`)
        setRecSub(`Your most repeated mistake — ${top.total_recurrences} occurrences`)
      } else {
        setRecHref('/practice/grammar/srs')
        setRecLabel('Spaced Review')
        setRecSub('Review patterns due today')
      }
    })
  }, [])

  const remHref = remQueue?.first_id
    ? `/practice/grammar/remediate/${remQueue.first_id}`
    : '/practice/grammar/all-mistakes'

  return (
    <>
      <Topbar />
      <main className="max-w-2xl mx-auto px-4 py-10">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6 text-xs text-[#6b7280]">
          <Link href="/practice" className="hover:text-[#2a7a7a]">Practice</Link>
          <span>/</span>
          <span className="font-medium text-[#1f2937]">Grammar</span>
        </div>

        <h1 className="text-xl font-bold text-[#1f2937] mb-2">Grammar Practice</h1>
        <p className="text-sm text-[#6b7280] mb-8">How do you want to practice today?</p>

        <div className="flex flex-col gap-4">

          {/* Recommended */}
          <button
            disabled={!recHref}
            onClick={() => recHref && router.push(recHref)}
            style={{ textAlign: 'left' }}
            className="card p-6 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all disabled:opacity-50 disabled:cursor-wait"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🎯</span>
                  <span className="font-bold text-[#1f2937] text-base">Recommended</span>
                </div>
                <div className="text-sm font-semibold text-[#2a7a7a] mt-2">{recLabel}</div>
                {recSub && (
                  <div className="text-xs text-[#6b7280] mt-0.5">{recSub}</div>
                )}
                <div className="text-xs text-[#9ca3af] mt-3">
                  The system picks what will move your score most right now
                </div>
              </div>
              <span className="text-[#2a7a7a] text-xl flex-shrink-0 mt-1">→</span>
            </div>
          </button>

          {/* Strengthen Patterns */}
          <Link href={remHref}
            className="card p-6 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">💪</span>
                  <span className="font-bold text-[#1f2937] text-base">Strengthen Patterns</span>
                  {remQueue && remQueue.pending > 0 && (
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700,
                      padding: '1px 8px', borderRadius: 10,
                      background: '#eaf5f3', color: '#2a7a7a',
                      border: '1px solid #c0dedd',
                    }}>
                      {remQueue.pending} pending
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#6b7280] mt-2">
                  Work through your logged errors — fix, learn the rule, then practice new sentences
                </div>
              </div>
              <span className="text-[#9ca3af] text-xl flex-shrink-0 mt-1">→</span>
            </div>
          </Link>

          {/* Manual */}
          <Link href="/practice/grammar/hub"
            className="card p-6 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🗂️</span>
                  <span className="font-bold text-[#1f2937] text-base">Manual</span>
                </div>
                <div className="text-xs text-[#6b7280] mt-2 mb-3">
                  Choose your own drill mode
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['Spaced Review', 'Pattern Drill', 'Flashcards', 'Transfer Challenges'].map(tag => (
                    <span key={tag} style={{
                      fontSize: '0.7rem', fontWeight: 600,
                      padding: '2px 9px', borderRadius: 10,
                      background: '#f3f4f6', color: '#6b7280',
                      border: '1px solid #e5e7eb',
                    }}>{tag}</span>
                  ))}
                </div>
              </div>
              <span className="text-[#9ca3af] text-xl flex-shrink-0 mt-1">→</span>
            </div>
          </Link>

          {/* All Mistakes */}
          <Link href="/practice/grammar/all-mistakes"
            className="card p-6 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">📋</span>
                  <span className="font-bold text-[#1f2937] text-base">All Mistakes</span>
                </div>
                <div className="text-xs text-[#6b7280] mt-2">
                  Browse and work through every error you have logged
                </div>
              </div>
              <span className="text-[#9ca3af] text-xl flex-shrink-0 mt-1">→</span>
            </div>
          </Link>

        </div>
      </main>
    </>
  )
}

export default function GrammarLandingPage() {
  return <RequireAuth><GrammarLandingContent /></RequireAuth>
}
