'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

// ── Interfaces ────────────────────────────────────────────────────────────────

interface TopCategory {
  category: string
  mistake_count: number
  total_recurrences: number
  unreviewed: number
}

interface Recommendations {
  top_categories: TopCategory[]
  total_mistakes: number
}

interface TrendRow {
  grammar_type: string
  remediation_status: string
  review_stage: number
  total_mistakes: number
  total_recurrences: number
  recent_14d: number
  prev_14d: number
  trend: 'improving' | 'regressing' | 'stable'
}

interface SRSDue {
  count: number
}

interface TransferTest {
  id: number
  grammar_type: string
  target_task_type: string
  drill_accuracy: number
  date_created: string
}

interface RemediationQueue {
  pending: number
  first_id: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STAGE_LABEL = ['New', '1 day', '3 days', '7 days', '14 days', '30 days']
const STAGE_COLOR = ['#9ca3af', '#f59e0b', '#3b82f6', '#2a7a7a', '#15803d', '#7c3aed']

const TREND_ICON:  Record<string, string> = { improving: '↓', regressing: '↑', stable: '→' }
const TREND_COLOR: Record<string, string> = { improving: '#15803d', regressing: '#dc2626', stable: '#6b7280' }
const TREND_LABEL: Record<string, string> = {
  improving:  'Errors declining',
  regressing: 'Errors re-appearing',
  stable:     'No recent change',
}
const STATUS_COLOR: Record<string, string> = {
  new:      '#9ca3af',
  engaged:  '#2a7a7a',
  mastered: '#15803d',
}

// ── TrendCard ─────────────────────────────────────────────────────────────────

function TrendCard({ row }: { row: TrendRow }) {
  const stage = Math.min(row.review_stage, 5)
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderRadius: 10, padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1f2937', marginBottom: 2 }}>
          {row.grammar_type}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: 10,
            background: STATUS_COLOR[row.remediation_status] + '18',
            color: STATUS_COLOR[row.remediation_status],
            border: `1px solid ${STATUS_COLOR[row.remediation_status]}44`,
          }}>
            {row.remediation_status === 'engaged' ? 'in progress' : row.remediation_status}
          </span>
          <span style={{ fontSize: '0.68rem', color: STAGE_COLOR[stage], fontWeight: 600 }}>
            Stage {stage} · next {STAGE_LABEL[stage]}
          </span>
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: TREND_COLOR[row.trend] }}>
          {TREND_ICON[row.trend]}
        </div>
        <div style={{ fontSize: '0.65rem', color: TREND_COLOR[row.trend], marginTop: 1 }}>
          {TREND_LABEL[row.trend]}
        </div>
      </div>

      <Link
        href={`/practice/grammar/all-mistakes?category=${encodeURIComponent(row.grammar_type)}`}
        style={{
          fontSize: '0.72rem', color: '#2a7a7a', fontWeight: 600,
          textDecoration: 'none', flexShrink: 0,
          padding: '4px 8px', borderRadius: 6,
          border: '1px solid #c0dedd', background: '#eaf5f3',
        }}
      >
        Drill →
      </Link>
    </div>
  )
}

// ── PracticeQueueCard ─────────────────────────────────────────────────────────

type DrillTab = 'srs' | 'pattern'

function PracticeQueueCard({
  remQueue, srsDue, rec,
}: {
  remQueue: RemediationQueue | null
  srsDue: number
  rec: Recommendations | null
}) {
  const defaultTab: DrillTab = srsDue > 0 ? 'srs' : 'pattern'
  const [tab, setTab] = useState<DrillTab>(defaultTab)

  const topCat = rec?.top_categories[0]

  const tabs: Record<DrillTab, { label: string; badge?: string; badgeRed?: boolean; desc: string; href: string; cta: string }> = {
    srs: {
      label: 'Spaced Review',
      badge: srsDue > 0 ? `${srsDue} due` : undefined,
      badgeRed: srsDue >= 10,
      desc: 'Review patterns due today based on your spaced-repetition schedule. Completing these advances each pattern toward mastery.',
      href: '/practice/grammar/srs',
      cta: srsDue > 0 ? `Start review (${srsDue} due)` : 'No items due — check back later',
    },
    pattern: {
      label: 'By Pattern',
      badge: topCat ? `${topCat.total_recurrences}×` : undefined,
      desc: topCat
        ? `AI-generated drills for your most repeated mistake type: ${topCat.category}. Isolate one pattern and drill until it feels automatic.`
        : 'AI-generated drills targeting your weakest grammar categories.',
      href: topCat
        ? `/practice/grammar/weakspot?category=${encodeURIComponent(topCat.category)}`
        : '/practice/grammar/weakspot',
      cta: topCat ? `Drill: ${topCat.category}` : 'Start Pattern Drill',
    },
  }

  const active = tabs[tab]

  return (
    <div style={{
      marginBottom: '1.5rem',
      border: '1px solid #e5e7eb',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 18px',
        background: '#f9fafb',
        borderBottom: '1px solid #e5e7eb',
      }}>
        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Practice Queue
        </span>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb' }}>
        {(Object.entries(tabs) as [DrillTab, typeof tabs[DrillTab]][]).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1, padding: '8px 4px',
              background: tab === key ? '#fff' : 'transparent',
              border: 'none',
              borderBottom: tab === key ? '2px solid #2a7a7a' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: tab === key ? 700 : 500,
              color: tab === key ? '#2a7a7a' : '#6b7280',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}
          >
            {cfg.label}
            {cfg.badge && (
              <span style={{
                fontSize: '0.63rem', fontWeight: 700,
                padding: '1px 6px', borderRadius: 8,
                background: cfg.badgeRed ? '#fee2e2' : '#eaf5f3',
                color: cfg.badgeRed ? '#dc2626' : '#2a7a7a',
              }}>
                {cfg.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <div style={{ padding: '14px 18px' }}>
        <p style={{ fontSize: '0.82rem', color: '#4b5563', margin: '0 0 12px', lineHeight: 1.5 }}>
          {active.desc}
        </p>
        <Link
          href={tab === 'srs' && srsDue === 0 ? '#' : active.href}
          style={{
            display: 'inline-block',
            padding: '8px 16px', borderRadius: 8,
            fontSize: '0.82rem', fontWeight: 700,
            background: tab === 'srs' && srsDue === 0 ? '#f3f4f6' : '#2a7a7a',
            color: tab === 'srs' && srsDue === 0 ? '#9ca3af' : '#fff',
            textDecoration: 'none',
            pointerEvents: tab === 'srs' && srsDue === 0 ? 'none' : 'auto',
          }}
        >
          {active.cta} {tab === 'srs' && srsDue === 0 ? '' : '→'}
        </Link>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

function GrammarHubContent() {
  const [rec, setRec]               = useState<Recommendations | null>(null)
  const [trends, setTrends]         = useState<TrendRow[]>([])
  const [srsDue, setSrsDue]         = useState(0)
  const [transfers, setTransfers]   = useState<TransferTest[]>([])
  const [remQueue, setRemQueue]     = useState<RemediationQueue | null>(null)

  useEffect(() => {
    function fetchAll() {
      api.get<Recommendations>('/api/grammar/recommendations')
        .then(setRec).catch(() => {})
      api.get<TrendRow[]>('/api/grammar/remediation-trends')
        .then(setTrends).catch(() => {})
      api.get<SRSDue>('/api/grammar/srs/due-count')
        .then(r => setSrsDue(r.count)).catch(() => {})
      api.get<{ pending: TransferTest[] }>('/api/grammar/transfer-tests')
        .then(r => setTransfers(r.pending)).catch(() => {})
      api.get<RemediationQueue>('/api/grammar/remediation-queue')
        .then(setRemQueue).catch(() => {})
    }
    fetchAll()
    const handlePageShow = (e: PageTransitionEvent) => { if (e.persisted) fetchAll() }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

  const improving  = trends.filter(t => t.trend === 'improving')
  const regressing = trends.filter(t => t.trend === 'regressing')
  const stable     = trends.filter(t => t.trend === 'stable' && t.remediation_status !== 'new')
  const mastered   = trends.filter(t => t.remediation_status === 'mastered')

  // Single priority action for "Your next step"
  const nextStep = (() => {
    if (srsDue > 0) return {
      label: 'Spaced Review due',
      sub: `${srsDue} pattern${srsDue !== 1 ? 's' : ''} scheduled for today — keep your streak`,
      href: '/practice/grammar/srs',
      badge: `${srsDue} due`,
      badgeRed: srsDue >= 10,
    }
    const top = rec?.top_categories[0]
    if (top) return {
      label: `Drill: ${top.category}`,
      sub: `Your most repeated mistake type — ${top.total_recurrences} occurrence${top.total_recurrences !== 1 ? 's' : ''}`,
      href: `/practice/grammar/weakspot?category=${encodeURIComponent(top.category)}`,
      badge: `${top.total_recurrences}×`,
      badgeRed: false,
    }
    return null
  })()

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

        <h1 className="text-xl font-bold text-[#1f2937] mb-1">Grammar Practice</h1>
        {/* Mastery summary — progress framing, not guilt count */}
        {trends.length > 0 && (
          <p className="text-xs text-[#6b7280] mb-6">
            {mastered.length > 0
              ? `${mastered.length} pattern${mastered.length !== 1 ? 's' : ''} mastered · ${improving.length} improving · ${regressing.length > 0 ? `${regressing.length} need attention` : 'none regressing'}`
              : `${improving.length} pattern${improving.length !== 1 ? 's' : ''} improving · ${rec?.total_mistakes ?? 0} total mistakes logged`
            }
          </p>
        )}

        {/* ── 1. Transfer Challenges (above the fold — authentic TOEFL tasks) ── */}
        {transfers.length > 0 && (
          <div style={{ marginBottom: '1.5rem', border: '1px solid #fde68a', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.95rem' }}>🎯</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#92400e', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Transfer Challenges
                </span>
                <span style={{ marginLeft: 8, fontSize: '0.72rem', color: '#b45309', fontWeight: 600 }}>
                  {transfers.length} ready
                </span>
              </div>
            </div>
            <div style={{ padding: '12px 18px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: '#78350f', lineHeight: 1.55 }}>
                You have drilled these patterns — now use them in real writing or speaking tasks,
                the way TOEFL actually scores them.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {transfers.slice(0, 3).map(tt => {
                  const isWriting = tt.target_task_type.toLowerCase().includes('discussion') || tt.target_task_type.toLowerCase().includes('email')
                  const slug = tt.target_task_type === 'Write for an Academic Discussion' ? 'discussion' : 'email'
                  const href = isWriting ? `/practice/writing/${slug}` : '/practice/speaking/interview'
                  return (
                    <Link key={tt.id} href={href}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderRadius: 8, border: '1px solid #fde68a', background: '#fff', textDecoration: 'none' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.83rem', color: '#1f2937' }}>{tt.grammar_type}</div>
                        <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>via {tt.target_task_type}</div>
                      </div>
                      <span style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 600, flexShrink: 0 }}>Go →</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── 2. Your next step (single priority action) ── */}
        {nextStep && (
          <div className="mb-6 rounded-xl border border-[#c0dedd] bg-[#eaf5f3] px-5 py-4">
            <p className="text-xs font-semibold text-[#2a7a7a] mb-3 uppercase tracking-wide">
              Your next step
            </p>
            <Link href={nextStep.href}
              className="flex items-center justify-between gap-3 rounded-lg bg-white border border-[#e6e8eb] px-4 py-3 hover:border-[#2a7a7a] hover:bg-[#f0faf9] transition-all group">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#1f2937] group-hover:text-[#2a7a7a] transition-colors">
                  {nextStep.label}
                </div>
                <div className="text-xs text-[#6b7280] mt-0.5 truncate">{nextStep.sub}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  nextStep.badgeRed ? 'bg-red-100 text-red-600' : 'bg-[#eaf5f3] text-[#2a7a7a]'
                }`}>
                  {nextStep.badge}
                </span>
                <span className="text-[#9ca3af] text-sm group-hover:text-[#2a7a7a] transition-colors">→</span>
              </div>
            </Link>
          </div>
        )}

        {/* ── 3. Practice Queue (Spaced Review / By Pattern / All Mistakes) ── */}
        <PracticeQueueCard remQueue={remQueue} srsDue={srsDue} rec={rec} />

        {/* ── 4. Flashcards (genuinely different interaction) ── */}
        <Link href="/practice/grammar/flashcards"
          className="card p-5 mb-4 hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all flex items-center justify-between gap-3">
          <div>
            <div className="font-bold text-sm text-[#1f2937]">Flashcards</div>
            <div className="text-xs text-[#6b7280] mt-0.5">Flip-card review — tap to reveal the correction</div>
          </div>
          <span className="text-[#9ca3af] text-sm">→</span>
        </Link>

        {/* ── 5. Pattern Progress ── */}
        {trends.length > 0 && (
          <div style={{
            marginTop: '0.5rem',
            marginBottom: '1.5rem',
            border: '1px solid #e5e7eb',
            borderRadius: 14,
            overflow: 'hidden',
          }}>
            <div style={{
              background: 'linear-gradient(135deg, #f9fafb, #f3f4f6)',
              borderBottom: '1px solid #e5e7eb',
              padding: '10px 18px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Pattern Progress
              </span>
              <div style={{ display: 'flex', gap: 10, fontSize: '0.72rem' }}>
                {improving.length > 0 && (
                  <span style={{ color: '#15803d', fontWeight: 600 }}>↓ {improving.length} improving</span>
                )}
                {regressing.length > 0 && (
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>↑ {regressing.length} re-appearing</span>
                )}
                {stable.length > 0 && (
                  <span style={{ color: '#6b7280' }}>→ {stable.length} stable</span>
                )}
              </div>
            </div>

            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {regressing.length > 0 && (
                <>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                    Needs attention
                  </div>
                  {regressing.map(r => <TrendCard key={r.grammar_type} row={r} />)}
                  {(improving.length > 0 || stable.length > 0) && (
                    <div style={{ height: 1, background: '#f3f4f6', margin: '4px 0' }} />
                  )}
                </>
              )}
              {improving.length > 0 && (
                <>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                    Declining errors
                  </div>
                  {improving.map(r => <TrendCard key={r.grammar_type} row={r} />)}
                  {stable.length > 0 && (
                    <div style={{ height: 1, background: '#f3f4f6', margin: '4px 0' }} />
                  )}
                </>
              )}
              {stable.map(r => <TrendCard key={r.grammar_type} row={r} />)}
            </div>

            {/* Jargon explainer */}
            <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 18px', background: '#fafafa' }}>
              <p style={{ fontSize: '0.68rem', color: '#9ca3af', margin: 0 }}>
                <strong style={{ color: '#6b7280' }}>Stage</strong> = how far through the 30-day spaced-repetition cycle (advances when you complete a drill loop) ·
                {' '}<strong style={{ color: '#6b7280' }}>in progress</strong> = actively drilling ·
                {' '}<strong style={{ color: '#6b7280' }}>Trend</strong> = last 14 days vs prior 14 days
              </p>
            </div>
          </div>
        )}

      </main>
    </>
  )
}

export default function GrammarHubPage() {
  return <RequireAuth><GrammarHubContent /></RequireAuth>
}
