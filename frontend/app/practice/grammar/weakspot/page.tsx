'use client'

import { AnnotatedSentence } from '@/components/CorrectionPopover'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

interface Sentence { wrong: string; correct: string; hint?: string; sub_type?: string }
interface GenerateResp { sentences: Sentence[] }

const CATEGORIES = [
  'Articles', 'Prepositions', 'Verb Forms', 'Tenses', 'Subject-Verb Agreement',
  'Word Order', 'Vocabulary', 'Plurals', 'Pronouns', 'Modals',
  'Questions', 'Relative Clauses', 'Phrasal Verbs',
]

const DIFFICULTIES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
type Difficulty = typeof DIFFICULTIES[number]

interface Item extends Sentence {
  user_answer: string
  verdict: 'correct' | 'partial' | 'wrong' | null
  feedback: string
}

function WeakSpotContent() {
  const searchParams = useSearchParams()
  const categoryParam = searchParams.get('category') || ''
  const initialCats = categoryParam
    ? categoryParam.split(',').filter(c => CATEGORIES.includes(c.trim()))
    : [CATEGORIES[0]]

  const [selectedCats, setSelectedCats] = useState<string[]>(
    initialCats.length > 0 ? initialCats : [CATEGORIES[0]]
  )
  const [count, setCount] = useState(5)
  const [difficulty, setDifficulty] = useState<Difficulty>('B1')
  const [customPrompt, setCustomPrompt] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoad] = useState(false)
  const [checking, setCheck] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [autoTriggered, setAutoTriggered] = useState(false)
  const [showHint, setShowHint] = useState<Record<number, boolean>>({})


  // Auto-generate when arriving via ?category= from a mistake detail drill link
  useEffect(() => {
    if (categoryParam && !autoTriggered) {
      setAutoTriggered(true)
      generate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleCat(cat: string) {
    setSelectedCats(prev => {
      if (prev.includes(cat)) {
        // Don't allow deselecting the last one
        if (prev.length === 1) return prev
        return prev.filter(c => c !== cat)
      }
      return [...prev, cat]
    })
  }

  async function generate() {
    setLoad(true)
    setSaved(false)
    try {
      const params: Record<string, string> = {
        category: selectedCats.join(','),
        count: String(count),
        difficulty: difficulty.toLowerCase(),
      }
      if (customPrompt.trim()) {
        params.custom_prompt = customPrompt.trim()
      }
      const res = await api.get<GenerateResp>('/api/grammar/weakspot/generate', params)
      setItems(res.sentences.map(s => ({ ...s, user_answer: '', verdict: null, feedback: '' })))
    } catch (e: unknown) {
      console.error(e)
    } finally {
      setLoad(false)
    }
  }

  async function checkItem(i: number) {
    const item = items[i]
    if (!item.user_answer.trim()) return
    setCheck(i)
    try {
      const res = await api.post<{ verdict: string; feedback: string }>('/api/grammar/evaluate', {
        user_answer: item.user_answer,
        correct: item.correct,
        wrong: item.wrong,
        category: selectedCats[0],
      })
      setItems(prev => prev.map((it, idx) => idx === i
        ? { ...it, verdict: res.verdict as Item['verdict'], feedback: res.feedback }
        : it
      ))
    } catch { /* silent */ }
    setCheck(null)
  }

  async function saveResults() {
    const results = items
      .filter(it => it.verdict !== null)
      .map(it => ({
        user_answer: it.user_answer,
        correct: it.correct,
        is_correct: it.verdict === 'correct',
        hint: it.hint ?? '',
        sub_type: it.sub_type ?? '',
      }))
    if (!results.length) return
    await api.post('/api/grammar/weakspot/submit', { category: selectedCats.join(','), results })
    setSaved(true)
  }

  const verdictStyle = (v: Item['verdict']) =>
    v === 'correct' ? 'border-green-400 bg-green-50' :
    v === 'partial'  ? 'border-amber-400 bg-amber-50' :
    v === 'wrong'    ? 'border-red-400 bg-red-50' : ''

  return (
    <>
      <Topbar />
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-2 text-xs text-[#6b7280]">
          <Link href="/practice/grammar" className="hover:text-[#2a7a7a]">Grammar</Link>
          <span>/</span>
          <span className="font-medium text-[#1f2937]">Weak Spot Drill</span>
        </div>
        <h1 className="text-xl font-bold text-[#1f2937]">Weak Spot Drill</h1>

        {/* Settings panel */}
        <div className="space-y-4 card p-5 border border-[#e6e8eb]">
          {/* Topic multi-select pills (click to toggle) */}
          <div>
            <label className="block text-xs font-medium text-[#6b7280] mb-1.5">Topics <span className="font-normal text-[#9ca3af]">(select multiple)</span></label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => toggleCat(c)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedCats.includes(c) ? 'bg-[#2a7a7a] text-white' : 'bg-[#f0f0f0] text-[#6b7280] hover:bg-[#e0e0e0]'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty single-select pills */}
          <div>
            <label className="block text-xs font-medium text-[#6b7280] mb-1.5">Difficulty</label>
            <div className="flex gap-2">
              {DIFFICULTIES.map(d => {
                const active = difficulty === d
                const colorMap: Record<Difficulty, string> = {
                  A1: active ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200',
                  A2: active ? 'bg-green-600 text-white'   : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200',
                  B1: active ? 'bg-amber-500 text-white'   : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200',
                  B2: active ? 'bg-orange-500 text-white'  : 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200',
                  C1: active ? 'bg-red-500 text-white'     : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200',
                  C2: active ? 'bg-red-700 text-white'     : 'bg-red-100 text-red-800 hover:bg-red-200 border border-red-300',
                }
                return (
                  <button key={d} onClick={() => setDifficulty(d)}
                    className={`px-4 py-1 rounded-full text-xs font-medium transition-colors ${colorMap[d]}`}>
                    {d}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Exercise count */}
          <div>
            <label className="block text-xs font-medium text-[#6b7280] mb-1.5">
              Number of exercises
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={e => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
              className="w-24 border border-[#e6e8eb] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a7a7a] focus:ring-2 focus:ring-[#2a7a7a]/10 transition"
            />
            <span className="text-xs text-[#9ca3af] ml-2">1–20</span>
          </div>

          {/* Custom prompt */}
          <div>
            <label className="block text-xs font-medium text-[#6b7280] mb-1.5">
              Custom instructions <span className="text-[#9ca3af] font-normal">(optional)</span>
            </label>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="e.g. Focus on academic writing context, use oil & gas vocabulary, make sentences longer..."
              rows={2}
              className="w-full border border-[#e6e8eb] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a7a7a] focus:ring-2 focus:ring-[#2a7a7a]/10 transition resize-none"
            />
          </div>

          <button onClick={generate} disabled={loading} className="btn-teal px-6">
            {loading ? 'Generating…' : 'Generate Drill'}
          </button>
        </div>

        {/* Drill items */}
        {items.length > 0 && (
          <div className="space-y-4">
            {items.map((item, i) => (
              <div key={i} className={`card p-5 border-2 ${item.verdict ? verdictStyle(item.verdict) : 'border-[#e6e8eb]'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs text-[#9ca3af]">Fix the error:</p>
                  {item.sub_type && (
                    <button
                      onClick={() => setShowHint(prev => ({ ...prev, [i]: !prev[i] }))}
                      className="text-xs px-2 py-0.5 rounded border border-[#e6e8eb] text-[#6b7280] hover:bg-[#f6f7f8] transition-colors"
                    >
                      {showHint[i] ? 'Hide hint' : 'Hint'}
                    </button>
                  )}
                </div>
                {showHint[i] && item.sub_type && (
                  <p className="text-xs text-[#2a7a7a] mb-2 italic">{item.sub_type}</p>
                )}
                <p className="text-sm font-medium text-[#1f2937] mb-3">
                  {item.verdict && item.verdict !== 'correct' ? (
                    <AnnotatedSentence wrong={item.wrong} correct={item.correct} />
                  ) : item.wrong}
                </p>

                <div className="flex gap-2">
                  <input
                    value={item.user_answer}
                    onChange={e => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, user_answer: e.target.value, verdict: null, feedback: '' } : it))}
                    onKeyDown={e => e.key === 'Enter' && checkItem(i)}
                    placeholder="Type the corrected sentence…"
                    className="flex-1 border border-[#e6e8eb] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a7a7a] focus:ring-2 focus:ring-[#2a7a7a]/10 transition"
                    disabled={item.verdict === 'correct'}
                  />
                  <button onClick={() => checkItem(i)} disabled={checking === i || item.verdict === 'correct'}
                    className="btn-teal px-4 disabled:opacity-50">
                    {checking === i ? '…' : 'Check'}
                  </button>
                </div>

                {item.verdict && (
                  <div className="mt-3 space-y-1">
                    <p className={`text-xs font-semibold ${
                      item.verdict === 'correct' ? 'text-green-600' :
                      item.verdict === 'partial'  ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {item.verdict === 'correct' ? '✓ Correct!' : item.verdict === 'partial' ? '~ Partially correct' : '✗ Incorrect'}
                    </p>
                    {item.feedback && <p className="text-xs text-[#6b7280]">{item.feedback}</p>}
                    {item.verdict !== 'correct' && (
                      <p className="text-xs text-[#2a7a7a]">Answer: {item.correct}</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="flex gap-3">
              <button onClick={saveResults} disabled={saved} className="btn-teal px-5 disabled:opacity-50">
                {saved ? '✓ Saved' : 'Save Results'}
              </button>
              <button onClick={generate} className="btn-teal px-5" style={{ background: '#f6f7f8', color: '#1f2937' }}>
                New Drill
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  )
}

export default function GrammarWeakSpotPage() {
  return <RequireAuth><WeakSpotContent /></RequireAuth>
}
