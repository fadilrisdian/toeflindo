'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GrammarMistake {
  id: number
  grammar_type: string
  sub_type: string
  wrong: string
  correct: string
  explanation: string
  reviewed: number
  recurrence_count: number
}

interface DimScores {
  content?: number; syntax?: number; lexical?: number; conventions?: number; accuracy?: number
}

interface Features {
  dimension_scores: DimScores
  prompt_similarity?: number; discourse_coherence?: number; elaboration_score?: number
  sentence_variety?: number; clause_complexity?: number; ttr?: number
  lexical_sophistication?: number; collocation_score?: number
  sophisticated_words?: string[]
  hedge_count?: number; modal_count?: number; has_greeting?: boolean; has_closing?: boolean
  politeness_score?: number; register_formality?: number
  spelling_error_rate?: number; spelling_errors?: string[]
  mechanical_error_count?: number; mechanical_errors?: string[]
}

interface Session {
  id: number; date: string; task_type: string; prompt: string
  response: string; score: number | null; feedback: string
  duration_minutes: number; tags: string; features: Features | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v?: number | null) { return v != null ? `${Math.round(v * 100)}%` : 'n/a' }
function flt(v?: number | null, d = 2) { return v != null ? v.toFixed(d) : 'n/a' }

function parseFeedback(raw: string) {
  let main = raw, strengths: string[] = [], improvements: string[] = [], polished = ''
  if (raw.includes('\n\nStrengths:')) {
    const [m, rest] = raw.split('\n\nStrengths:', 2)
    main = m
    const rest2 = rest.includes('\n\nAreas for Improvement:')
      ? rest
      : rest.replace('\n\nImprovements:', '\n\nAreas for Improvement:')
    if (rest2.includes('\n\nAreas for Improvement:')) {
      const [s, rest3] = rest2.split('\n\nAreas for Improvement:', 2)
      strengths = s.trim().split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
      if (rest3.includes('\n\nPolished Version:')) {
        const [imp, pol] = rest3.split('\n\nPolished Version:', 2)
        improvements = imp.trim().split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
        polished = pol.trim()
      } else {
        improvements = rest3.trim().split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
      }
    }
  }
  return { main, strengths, improvements, polished }
}

function scoreColor(score: number | null) {
  if (score == null) return '#6b7280'
  if (score >= 4) return '#16a34a'
  if (score >= 3) return '#d97706'
  return '#dc2626'
}

type DimKey = 'content' | 'syntax' | 'lexical' | 'conventions' | 'accuracy'
const DIMS: { key: DimKey; label: string }[] = [
  { key: 'content',     label: 'Content' },
  { key: 'syntax',      label: 'Syntax' },
  { key: 'lexical',     label: 'Vocabulary' },
  { key: 'conventions', label: 'Conventions' },
  { key: 'accuracy',    label: 'Accuracy' },
]

function dimVal(f: Features | null, key: DimKey): number | null {
  return f?.dimension_scores?.[key] ?? null
}
function dimColor(f: Features | null, key: DimKey) {
  const v = dimVal(f, key)
  if (v == null) return '#9ca3af'
  return v >= 0.6 ? '#16a34a' : '#d97706'
}

// ── Highlight engine ──────────────────────────────────────────────────────────

const STOPWORDS = new Set(['the','a','an','in','on','at','to','for','of','and','or','but','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','i','you','he','she','it','we','they','my','your','his','her','its','our','their','this','that','these','those','as','by','with','from','up','about','than','then','so','if','not','no','more','also','just','very','well','get','go','got','make','take','see','know','come','give','use','find','think','say','tell'])

const DISCOURSE_RE  = /\b(however|therefore|furthermore|moreover|in addition|additionally|on the other hand|as a result|consequently|nevertheless|nonetheless|in contrast|similarly|for example|for instance|in conclusion|to summarize|first|second|third|finally|then|next|after that|in other words|that is|specifically|in fact|indeed|of course|although|even though|while|whereas|despite|instead|otherwise|thus|hence|yet|still|overall|in general|to begin with|lastly|in summary)\b/gi
const HEDGE_RE      = /\b(might|may|could|possibly|perhaps|seems|seem|appears|appear|likely|unlikely|probably|generally|usually|often|sometimes|tend|tends|suggest|suggests|indicate|indicates|arguably|somewhat|rather|fairly|quite|relatively|typically|approximately|I think|I believe|I feel|in my opinion|to some extent|in some cases)\b/gi
const MODAL_RE      = /\b(would|could|should|might|must|can|will|shall|may|ought to|need to|have to|used to)\b/gi
const POLITE_RE     = /\b(please|thank you|thanks|I would appreciate|I hope|kindly|I am writing|I am looking forward|I would like|could you|would you|I wonder if|if possible|I apologize|sorry|I am sorry|best regards|sincerely|I appreciate|grateful)\b/gi
const INFORMAL_RE   = /\b(gonna|wanna|gotta|kinda|sorta|yeah|yep|nope|stuff|lots|a lot|anyway|ok|okay|cause|cos|dunno|lemme|gimme|ain't)\b/gi
const SUBORD_RE     = /\b(because|since|although|though|even though|while|whereas|unless|until|after|before|when|whenever|where|wherever|if|whether|so that|in order that|which|who|whom|whose|what)\b/gi
const SENTENCE_COLORS = ['#fef9c3','#d1fae5','#dbeafe','#fce7f3','#e0e7ff','#ffedd5','#f3e8ff']

type SpanChunk = { text: string; color: string | null }

function regexChunks(text: string, re: RegExp, color: string): SpanChunk[] {
  const chunks: SpanChunk[] = []
  const g = new RegExp(re.source, re.flags.replace('g', '') + 'g')
  let last = 0, m: RegExpExecArray | null
  while ((m = g.exec(text)) !== null) {
    if (m.index > last) chunks.push({ text: text.slice(last, m.index), color: null })
    chunks.push({ text: m[0], color })
    last = m.index + m[0].length
  }
  if (last < text.length) chunks.push({ text: text.slice(last), color: null })
  return chunks.length ? chunks : [{ text, color: null }]
}

function wordListChunks(text: string, words: string[], color: string): SpanChunk[] {
  if (!words.length) return [{ text, color: null }]
  const esc = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return regexChunks(text, new RegExp(`\\b(${esc.join('|')})\\b`, 'gi'), color)
}

function buildHighlightSpans(text: string, label: string | null, f: Features, prompt: string): SpanChunk[] {
  if (!label) return [{ text, color: null }]
  switch (label) {
    case 'Prompt relevance': {
      const kws: string[] = []
      let m: RegExpExecArray | null
      const kwRe = /\b[a-zA-Z]{4,}\b/g
      while ((m = kwRe.exec(prompt)) !== null) {
        const w = m[0].toLowerCase()
        if (!STOPWORDS.has(w) && !kws.includes(w)) kws.push(w)
      }
      return wordListChunks(text, kws, '#bfdbfe')
    }
    case 'Discourse coherence':
      return regexChunks(text, DISCOURSE_RE, '#a7f3d0')
    case 'Elaboration depth':
      return regexChunks(text, SUBORD_RE, '#fde68a')
    case 'Sentence variety': {
      const sentences = text.match(/[^.!?]+[.!?]+(\s*\n*)?|[^.!?]+$/g) ?? [text]
      return sentences.map((s, i) => ({ text: s, color: SENTENCE_COLORS[i % SENTENCE_COLORS.length] }))
    }
    case 'Clause complexity':
      return regexChunks(text, SUBORD_RE, '#ddd6fe')
    case 'Vocabulary range (CTTR)': {
      const freq: Record<string, number> = {}
      let m2: RegExpExecArray | null
      const wRe = /\b[a-zA-Z]{3,}\b/g
      while ((m2 = wRe.exec(text)) !== null) {
        const w = m2[0].toLowerCase()
        if (!STOPWORDS.has(w)) freq[w] = (freq[w] ?? 0) + 1
      }
      return wordListChunks(text, Object.keys(freq).filter(w => freq[w] > 1), '#fecaca')
    }
    case 'Lexical sophistication':
      return wordListChunks(text, f.sophisticated_words ?? [], '#c7d2fe')
    case 'Collocation accuracy':
      return [{ text, color: null }]
    case 'Hedge words used':
      return regexChunks(text, HEDGE_RE, '#a7f3d0')
    case 'Modal verbs used':
      return regexChunks(text, MODAL_RE, '#6ee7b7')
    case 'Politeness':
      return regexChunks(text, POLITE_RE, '#fbcfe8')
    case 'Register formality':
      return regexChunks(text, INFORMAL_RE, '#fca5a5')
    case 'Greeting / Closing': {
      const lines = text.split('\n').filter(Boolean)
      if (lines.length < 2) return [{ text, color: null }]
      const toEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(${toEsc(lines[0])}|${toEsc(lines[lines.length - 1])})`)
      return regexChunks(text, re, '#fbcfe8')
    }
    case 'Spelling errors':
      return wordListChunks(text, f.spelling_errors ?? [], '#fca5a5')
    case 'Punctuation issues':
      return wordListChunks(text, f.mechanical_errors ?? [], '#fca5a5')
    default:
      return [{ text, color: null }]
  }
}

function HighlightedResponse({ text, label, f, prompt }: { text: string; label: string | null; f: Features | null; prompt: string }) {
  const base: React.CSSProperties = { margin: 0, fontSize: '0.88rem', lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap' }
  if (!f || !label) return <p style={base}>{text}</p>
  const chunks = buildHighlightSpans(text, label, f, prompt)
  return (
    <p style={base}>
      {chunks.map((c, i) =>
        c.color
          ? <mark key={i} style={{ background: c.color, borderRadius: 3, padding: '0 1px', color: 'inherit' }}>{c.text}</mark>
          : <span key={i}>{c.text}</span>
      )}
    </p>
  )
}

// ── Sub-metric data-driven explanations ──────────────────────────────────────

function computeSubMetricDetail(
  label: string,
  f: Features,
  response: string,
  prompt: string,
): React.ReactNode {
  const dim = (style: React.CSSProperties, children: React.ReactNode) => (
    <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#374151', lineHeight: 1.7, ...style }}>{children}</div>
  )
  const pill = (text: string, bg: string, color: string, key: number) => (
    <span key={key} style={{ display: 'inline-block', background: bg, color, borderRadius: 4, padding: '1px 6px', fontSize: '0.7rem', margin: '2px 3px 2px 0', border: `1px solid ${color}33` }}>{text}</span>
  )
  const row = (label: string, value: React.ReactNode) => (
    <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
      <span style={{ color: '#6b7280', minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )

  switch (label) {
    case 'Prompt relevance': {
      const kws: string[] = []
      let m: RegExpExecArray | null
      const kwRe = /\b[a-zA-Z]{4,}\b/g
      while ((m = kwRe.exec(prompt)) !== null) {
        const w = m[0].toLowerCase()
        if (!STOPWORDS.has(w) && !kws.includes(w)) kws.push(w)
      }
      const responseLower = response.toLowerCase()
      const found = kws.filter(w => responseLower.includes(w))
      const missing = kws.filter(w => !responseLower.includes(w)).slice(0, 6)
      return dim({}, <>
        {row('Prompt keywords', `${kws.length} extracted`)}
        {row('Used in response', `${found.length} of ${kws.length}`)}
        {missing.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <span style={{ color: '#6b7280' }}>Not found: </span>
            {missing.map((w, i) => pill(w, '#fff1f2', '#be123c', i))}
            {kws.filter(w => !responseLower.includes(w)).length > 6 && (
              <span style={{ color: '#9ca3af' }}> +{kws.filter(w => !responseLower.includes(w)).length - 6} more</span>
            )}
          </div>
        )}
        {found.slice(0, 6).length > 0 && (
          <div style={{ marginTop: 4 }}>
            <span style={{ color: '#6b7280' }}>Found: </span>
            {found.slice(0, 6).map((w, i) => pill(w, '#eff6ff', '#1d4ed8', i))}
          </div>
        )}
      </>)
    }

    case 'Discourse coherence': {
      const g = new RegExp(DISCOURSE_RE.source, 'gi')
      const matches: string[] = []
      let m: RegExpExecArray | null
      while ((m = g.exec(response)) !== null) matches.push(m[0].toLowerCase())
      const unique = [...new Set(matches)]
      return dim({}, <>
        {row('Markers found', `${matches.length} uses (${unique.length} unique)`)}
        {unique.length > 0
          ? <div style={{ marginTop: 4 }}>{unique.slice(0, 8).map((w, i) => pill(w, '#ecfdf5', '#065f46', i))}</div>
          : <div style={{ marginTop: 4, color: '#dc2626' }}>None found — try adding "however", "therefore", "in addition"</div>
        }
      </>)
    }

    case 'Elaboration depth': {
      const g = new RegExp(SUBORD_RE.source, 'gi')
      const matches: string[] = []
      let m: RegExpExecArray | null
      while ((m = g.exec(response)) !== null) matches.push(m[0].toLowerCase())
      const unique = [...new Set(matches)]
      const sentences = response.match(/[^.!?]+[.!?]+/g) ?? []
      return dim({}, <>
        {row('Subordinate clauses', `${matches.length} (in ~${sentences.length} sentences)`)}
        {unique.length > 0
          ? <div style={{ marginTop: 4 }}>{unique.slice(0, 8).map((w, i) => pill(w, '#fefce8', '#854d0e', i))}</div>
          : <div style={{ marginTop: 4, color: '#dc2626' }}>None found — try using "because", "although", "since", "which"</div>
        }
      </>)
    }

    case 'Sentence variety': {
      const sentences = (response.match(/[^.!?]+[.!?]+(\s*\n*)?|[^.!?]+$/g) ?? []).filter(s => s.trim().length > 3)
      const lengths = sentences.map(s => s.trim().split(/\s+/).length)
      const short = lengths.filter(l => l <= 10).length
      const medium = lengths.filter(l => l > 10 && l < 25).length
      const long = lengths.filter(l => l >= 25).length
      const avg = lengths.length ? (lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1) : '0'
      const minL = lengths.length ? Math.min(...lengths) : 0
      const maxL = lengths.length ? Math.max(...lengths) : 0
      return dim({}, <>
        {row('Sentence count', sentences.length)}
        {row('Avg length', `${avg} words (${minL}–${maxL})`)}
        <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
          {pill(`Short ≤10w: ${short}`, '#eff6ff', '#1d4ed8', 0)}
          {pill(`Medium: ${medium}`, '#f0fdf4', '#166534', 1)}
          {pill(`Long ≥25w: ${long}`, '#faf5ff', '#6b21a8', 2)}
        </div>
        {short === 0 && <div style={{ marginTop: 4, color: '#d97706' }}>Try adding some short punchy sentences to vary the rhythm.</div>}
        {long === 0 && <div style={{ marginTop: 4, color: '#d97706' }}>Try adding longer complex sentences to show grammatical range.</div>}
      </>)
    }

    case 'Clause complexity': {
      const val = f.clause_complexity
      const target = 2.0
      return dim({}, <>
        {row('Your avg', val != null ? `${val.toFixed(2)} clauses/sentence` : 'n/a')}
        {row('Target', `≥ ${target.toFixed(1)} for a strong score`)}
        {val != null && val < target && (
          <div style={{ marginTop: 4, color: '#d97706' }}>
            Add more relative clauses, conditional phrases, or subordinate clauses to increase complexity.
          </div>
        )}
        {val != null && val >= target && (
          <div style={{ marginTop: 4, color: '#16a34a' }}>Good complexity level — sentences contain multiple clauses.</div>
        )}
      </>)
    }

    case 'Vocabulary range (CTTR)': {
      const freq: Record<string, number> = {}
      let m2: RegExpExecArray | null
      const wRe = /\b[a-zA-Z]{3,}\b/g
      let total = 0
      while ((m2 = wRe.exec(response)) !== null) {
        const w = m2[0].toLowerCase()
        if (!STOPWORDS.has(w)) { freq[w] = (freq[w] ?? 0) + 1; total++ }
      }
      const unique = Object.keys(freq).length
      const repeated = Object.entries(freq).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 6)
      return dim({}, <>
        {row('Content words', `${unique} unique of ${total} total`)}
        {repeated.length > 0 && <>
          <div style={{ marginTop: 4, color: '#6b7280' }}>Most repeated:</div>
          <div>{repeated.map(([w, c], i) => pill(`${w} ×${c}`, '#fff1f2', '#be123c', i))}</div>
        </>}
        {repeated.length === 0 && <div style={{ marginTop: 4, color: '#16a34a' }}>No significant word repetition detected.</div>}
      </>)
    }

    case 'Lexical sophistication': {
      const words = f.sophisticated_words
      const total = response.trim().split(/\s+/).length
      // undefined = old session scored before sophisticated_words was stored
      const isOldSession = words === undefined || words === null
      const wordList = words ?? []
      return dim({}, <>
        {row('Beyond top-2000', isOldSession ? 'n/a (old session)' : `${wordList.length} unique words`)}
        {!isOldSession && row('% of response', `${total ? ((wordList.length / total) * 100).toFixed(1) : 0}%`)}
        {isOldSession
          ? <div style={{ marginTop: 4, color: '#6b7280' }}>
              Word list not available — scored before this feature was added.
              Submit a new practice to see the exact words highlighted.
            </div>
          : wordList.length > 0
            ? <>
                <div style={{ marginTop: 4, fontSize: '0.7rem', color: '#6b7280', marginBottom: 4 }}>
                  Words below top-2000 frequency (wordfreq Zipf &lt; 5.0):
                </div>
                <div>
                  {wordList.slice(0, 12).map((w, i) => pill(w, '#eef2ff', '#3730a3', i))}
                  {wordList.length > 12 && <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}> +{wordList.length - 12} more</span>}
                </div>
              </>
            : <div style={{ color: '#d97706' }}>No sophisticated vocabulary detected. Try using more precise academic words.</div>
        }
      </>)
    }

    case 'Collocation accuracy': {
      const score = f.collocation_score
      return dim({}, <>
        {row('Score', score != null ? `${(score * 100).toFixed(0)}%` : 'n/a')}
        <div style={{ marginTop: 4, color: '#6b7280' }}>
          Collocation accuracy measures natural word pairings (e.g. "make a decision" not "do a decision").
          Review your verb-noun combinations and fixed expressions manually.
        </div>
      </>)
    }

    case 'Hedge words used': {
      const g = new RegExp(HEDGE_RE.source, 'gi')
      const matches: string[] = []
      let m: RegExpExecArray | null
      while ((m = g.exec(response)) !== null) matches.push(m[0].toLowerCase())
      const unique = [...new Set(matches)]
      return dim({}, <>
        {row('Hedge expressions', `${matches.length} found`)}
        {unique.length > 0
          ? <div style={{ marginTop: 4 }}>{unique.slice(0, 8).map((w, i) => pill(w, '#ecfdf5', '#065f46', i))}</div>
          : <div style={{ marginTop: 4, color: '#d97706' }}>None found. Try "I believe", "it seems", "perhaps", "this might suggest".</div>
        }
      </>)
    }

    case 'Modal verbs used': {
      const g = new RegExp(MODAL_RE.source, 'gi')
      const matches: string[] = []
      let m: RegExpExecArray | null
      while ((m = g.exec(response)) !== null) matches.push(m[0].toLowerCase())
      const freq: Record<string, number> = {}
      matches.forEach(w => freq[w] = (freq[w] ?? 0) + 1)
      return dim({}, <>
        {row('Modal uses', `${matches.length} found`)}
        {Object.keys(freq).length > 0
          ? <div style={{ marginTop: 4 }}>{Object.entries(freq).map(([w, c], i) => pill(`${w} ×${c}`, '#ecfdf5', '#065f46', i))}</div>
          : <div style={{ marginTop: 4, color: '#d97706' }}>None found. Try "would", "could", "should", "might".</div>
        }
      </>)
    }

    case 'Politeness': {
      const g = new RegExp(POLITE_RE.source, 'gi')
      const matches: string[] = []
      let m: RegExpExecArray | null
      while ((m = g.exec(response)) !== null) matches.push(m[0])
      const unique = [...new Set(matches.map(s => s.toLowerCase()))]
      return dim({}, <>
        {row('Polite phrases', `${matches.length} found`)}
        {unique.length > 0
          ? <div style={{ marginTop: 4 }}>{unique.slice(0, 6).map((w, i) => pill(w, '#fdf2f8', '#9d174d', i))}</div>
          : <div style={{ marginTop: 4, color: '#d97706' }}>None found. Add phrases like "I would appreciate", "please", "thank you".</div>
        }
      </>)
    }

    case 'Register formality': {
      const g = new RegExp(INFORMAL_RE.source, 'gi')
      const matches: string[] = []
      let m: RegExpExecArray | null
      while ((m = g.exec(response)) !== null) matches.push(m[0].toLowerCase())
      const unique = [...new Set(matches)]
      return dim({}, <>
        {row('Informal words', `${unique.length} found`)}
        {unique.length > 0
          ? <>
              <div style={{ marginTop: 4 }}>{unique.map((w, i) => pill(w, '#fff1f2', '#be123c', i))}</div>
              <div style={{ marginTop: 4, color: '#d97706' }}>Replace these with formal equivalents to improve register.</div>
            </>
          : <div style={{ marginTop: 4, color: '#16a34a' }}>No informal language detected. Good formal register.</div>
        }
      </>)
    }

    case 'Greeting / Closing': {
      const lines = response.split('\n').filter(l => l.trim().length > 0)
      const first = lines[0] ?? ''
      const last = lines[lines.length - 1] ?? ''
      return dim({}, <>
        {row('Greeting', f.has_greeting
          ? <span style={{ color: '#16a34a' }}>✓ detected</span>
          : <span style={{ color: '#dc2626' }}>✗ not detected</span>)}
        {first && <div style={{ marginTop: 2, fontStyle: 'italic', color: '#374151' }}>"{first.slice(0, 60)}{first.length > 60 ? '…' : ''}"</div>}
        {row('Closing', f.has_closing
          ? <span style={{ color: '#16a34a' }}>✓ detected</span>
          : <span style={{ color: '#dc2626' }}>✗ not detected</span>)}
        {last && last !== first && <div style={{ marginTop: 2, fontStyle: 'italic', color: '#374151' }}>"{last.slice(0, 60)}{last.length > 60 ? '…' : ''}"</div>}
      </>)
    }

    case 'Spelling errors': {
      const errors = f.spelling_errors ?? []
      return dim({}, <>
        {row('Error rate', `${f.spelling_error_rate?.toFixed(2) ?? 'n/a'} per 100 words`)}
        {row('Words flagged', errors.length)}
        {errors.length > 0
          ? <div style={{ marginTop: 4 }}>{errors.map((w, i) => pill(w, '#fff1f2', '#be123c', i))}</div>
          : <div style={{ marginTop: 4, color: '#16a34a' }}>No spelling errors detected.</div>
        }
      </>)
    }

    case 'Punctuation issues': {
      const errors = f.mechanical_errors ?? []
      const count = f.mechanical_error_count ?? 0
      return dim({}, <>
        {row('Issues found', count)}
        {errors.length > 0
          ? <div style={{ marginTop: 4 }}>{errors.map((w, i) => pill(w, '#fff1f2', '#be123c', i))}</div>
          : <div style={{ marginTop: 4, color: count === 0 ? '#16a34a' : '#d97706' }}>
              {count === 0 ? 'No punctuation errors detected.' : 'Check for missing commas, double spaces, or incorrect apostrophes.'}
            </div>
        }
      </>)
    }

    default:
      return null
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SubMetric({ label, value, activeLabel, onSelect, f, response, prompt }: {
  label: string; value: string
  activeLabel: string | null
  onSelect: (label: string) => void
  f: Features
  response: string
  prompt: string
}) {
  const isActive = activeLabel === label
  const detail = isActive ? computeSubMetricDetail(label, f, response, prompt) : null
  return (
    <div
      onClick={() => onSelect(label)}
      style={{
        padding: '6px 8px', borderBottom: '1px solid #f3f4f6', fontSize: '0.8rem',
        borderRadius: 6, cursor: 'pointer',
        background: isActive ? '#f0fdf4' : 'transparent',
        outline: isActive ? '2px solid #2a7a7a' : 'none',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: isActive ? '#2a7a7a' : '#6b7280', fontWeight: isActive ? 700 : 400 }}>{label}</span>
        <span style={{ color: '#374151', fontWeight: 600 }}>{value}</span>
      </div>
      {isActive && detail}
    </div>
  )
}

function DimDetail({ dimKey, f, isEmail, activeLabel, onSelect, response, prompt }: {
  dimKey: DimKey; f: Features; isEmail: boolean
  activeLabel: string | null
  onSelect: (label: string) => void
  response: string
  prompt: string
}) {
  const sm = (label: string, value: string) => (
    <SubMetric label={label} value={value} activeLabel={activeLabel} onSelect={onSelect} f={f} response={response} prompt={prompt} />
  )
  if (dimKey === 'content') return (
    <div className="ws-dim-detail">
      {sm('Prompt relevance',    pct(f.prompt_similarity))}
      {sm('Discourse coherence', pct(f.discourse_coherence))}
      {sm('Elaboration depth',   pct(f.elaboration_score))}
      <p style={{ fontSize: '0.76rem', color: '#6b7280', margin: '8px 0 0' }}>
        Measures how well you addressed the task and developed your ideas across sentences.
      </p>
    </div>
  )
  if (dimKey === 'syntax') return (
    <div className="ws-dim-detail">
      {sm('Sentence variety',  pct(f.sentence_variety))}
      {sm('Clause complexity', `${flt(f.clause_complexity)} avg clauses/sentence`)}
      <p style={{ fontSize: '0.76rem', color: '#6b7280', margin: '8px 0 0' }}>
        Reflects variety in sentence structures — simple, compound, and complex sentences.
      </p>
    </div>
  )
  if (dimKey === 'lexical') return (
    <div className="ws-dim-detail">
      {sm('Vocabulary range (CTTR)', pct(f.ttr))}
      {sm('Lexical sophistication',  pct(f.lexical_sophistication))}
      {sm('Collocation accuracy',    pct(f.collocation_score))}
      <p style={{ fontSize: '0.76rem', color: '#6b7280', margin: '8px 0 0' }}>
        Tracks word variety, use of advanced vocabulary, and natural word combinations.
      </p>
    </div>
  )
  if (dimKey === 'conventions') return (
    <div className="ws-dim-detail">
      {sm('Hedge words used',   String(f.hedge_count ?? 0))}
      {sm('Modal verbs used',   String(f.modal_count ?? 0))}
      {sm('Politeness',         pct(f.politeness_score))}
      {sm('Register formality', pct(f.register_formality))}
      {isEmail && sm('Greeting / Closing', `${f.has_greeting ? '✓' : '✗'} / ${f.has_closing ? '✓' : '✗'}`)}
      <p style={{ fontSize: '0.76rem', color: '#6b7280', margin: '8px 0 0' }}>
        Covers appropriate register, polite phrasing, and email structure conventions.
      </p>
    </div>
  )
  if (dimKey === 'accuracy') {
    const spellRate = f.spelling_error_rate != null ? f.spelling_error_rate.toFixed(2) : 'n/a'
    const mechCount = f.mechanical_error_count ?? 0
    const spellBad = (f.spelling_error_rate ?? 0) > 1
    const mechBad = mechCount > 2
    return (
      <div className="ws-dim-detail">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
          <div style={{ background: 'var(--surface-0, #f8f9fa)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Spelling errors</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: spellBad ? '#dc2626' : '#16a34a' }}>{spellRate}</div>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>per 100 words</div>
            {f.spelling_errors && f.spelling_errors.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {f.spelling_errors.slice(0, 4).map((w: string, i: number) => (
                  <span key={i} style={{ background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: 3, padding: '1px 5px', fontSize: '0.7rem' }}>{w}</span>
                ))}
                {f.spelling_errors.length > 4 && (
                  <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>+{f.spelling_errors.length - 4}</span>
                )}
              </div>
            )}
          </div>
          <div style={{ background: 'var(--surface-0, #f8f9fa)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Punctuation issues</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: mechBad ? '#dc2626' : '#16a34a' }}>{mechCount}</div>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>mechanical errors</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {sm('Spelling errors',    `${f.spelling_errors?.length ?? 0} words`)}
          {sm('Punctuation issues', `${mechCount} issues`)}
        </div>
        <p style={{ fontSize: '0.76rem', color: '#6b7280', margin: '8px 0 0' }}>
          Spelling and punctuation accuracy — fewer errors signal stronger language control.
        </p>
      </div>
    )
  }
  return null
}

// ── Main content ──────────────────────────────────────────────────────────────

function SessionDetailContent({ id }: { id: string }) {
  const router = useRouter()
  const [session, setSession]       = useState<Session | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [mistakes, setMistakes]     = useState<GrammarMistake[]>([])
  const [promptOpen, setPromptOpen] = useState(false)
  const [showModel, setShowModel]   = useState(false)
  const [activeDim, setActiveDim]   = useState<DimKey | null>(null)
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const responseRef = useRef<HTMLDivElement>(null)

  const handleSubMetricSelect = useCallback((label: string) => {
    setActiveLabel(prev => prev === label ? null : label)
    setTimeout(() => {
      responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }, [])

  useEffect(() => {
    api.get<Session>(`/api/writing/sessions/${id}`)
      .then(setSession)
      .catch(() => setError('Session not found.'))
      .finally(() => setLoading(false))

    api.get<{ mistakes: GrammarMistake[] }>(`/api/writing/sessions/${id}/grammar-mistakes`)
      .then(d => setMistakes(d.mistakes ?? []))
      .catch(() => {}) // non-fatal
  }, [id])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Topbar />
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ width: 32, height: 32, border: '3px solid #d1e8e8', borderTopColor: '#2a7a7a', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    </div>
  )

  if (error || !session) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Topbar />
      <div className="db-container" style={{ textAlign: 'center', paddingTop: 48 }}>
        <p style={{ color: 'var(--muted)' }}>{error || 'Session not found.'}</p>
        <button onClick={() => router.push('/dashboard/writing')} className="btn-teal" style={{ marginTop: 12 }}>← Back</button>
      </div>
    </div>
  )

  const { main, strengths, improvements, polished } = parseFeedback(session.feedback || '')
  const f = session.features
  const isEmail = session.task_type === 'Write an Email'
  const sc = scoreColor(session.score)
  const dateStr = session.date
    ? new Date(session.date).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : ''

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <Topbar />

      <div className="db-container">

        {/* 1. Top Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1.2rem' }}>
          <button onClick={() => router.push('/dashboard/writing')}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>
            ← Back
          </button>
          <span style={{ background: 'var(--teal-50)', color: 'var(--teal-700)', border: '1px solid #c0dedd', borderRadius: 999, padding: '3px 12px', fontSize: '0.78rem', fontWeight: 600 }}>
            {session.task_type}
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{dateStr}</span>
        </div>

        {/* 2. Score Banner */}
        <div className="card-w section-gap" style={{ borderLeft: `4px solid ${sc}`, padding: '1.2rem 1.4rem' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'center', minWidth: 72, flexShrink: 0 }}>
              <div style={{ fontSize: '2.4rem', fontWeight: 800, color: sc, lineHeight: 1 }}>{session.score?.toFixed(1) ?? '—'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2 }}>Score</div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              {main && <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.6 }}>{main}</p>}
            </div>
          </div>
        </div>

        {/* 3. Prompt collapsible */}
        <div className="card-w section-gap" style={{ padding: 0, overflow: 'hidden' }}>
          <button onClick={() => setPromptOpen(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
            View prompt
            <span style={{ transition: 'transform 0.2s', transform: promptOpen ? 'rotate(180deg)' : 'none', color: 'var(--muted)' }}>▾</span>
          </button>
          {promptOpen && (
            <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--border)' }}>
              <p style={{ margin: '12px 0 0', fontSize: '0.88rem', color: '#5a2d82', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{session.prompt}</p>
            </div>
          )}
        </div>

        {/* 4. Response Comparison */}
        <div className="section-gap">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>Your response</span>
            {polished && (
              <button onClick={() => setShowModel(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: `1px solid ${showModel ? 'var(--teal-700)' : 'var(--border)'}`, background: showModel ? 'var(--teal-50)' : 'white', color: showModel ? 'var(--teal-700)' : 'var(--muted)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                {showModel ? '✕ Hide AI model answer' : '✏️ Compare with AI model answer'}
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: showModel ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', gap: 16 }}>
            <div className="card-w" ref={responseRef} style={{ padding: '1rem 1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--teal-700)', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--teal-700)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your response</span>
                  {activeLabel && (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, background: '#f0fdf4', border: '1px solid #2a7a7a', borderRadius: 999, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600, color: '#2a7a7a' }}>
                      🔍 {activeLabel}
                      <button onClick={() => setActiveLabel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2a7a7a', padding: 0, lineHeight: 1, fontSize: '0.8rem' }}>✕</button>
                    </span>
                  )}
                </div>
                <HighlightedResponse text={session.response} label={activeLabel} f={f} prompt={session.prompt} />
              </div>
            {showModel && polished && (
              <div className="card-w" style={{ padding: '1rem 1.2rem', borderLeft: '3px solid var(--teal-700)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6c7fe8', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.73rem', fontWeight: 700, color: '#6c7fe8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI-generated revision</span>
                  </div>
                  <button onClick={() => navigator.clipboard.writeText(polished)}
                    style={{ fontSize: '0.72rem', color: 'var(--muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>Copy</button>
                </div>
                <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{polished}</p>
              </div>
            )}
          </div>
        </div>

        {/* 5. Writing Analysis */}
        {f && (
          <div className="section-gap">
            <div className="section-title" style={{ marginTop: 0 }}>Writing analysis</div>
            <div className="ws-analysis-wrap">
              <div className="ws-chips-row">
                {DIMS.filter(d => d.key !== 'conventions' || isEmail).map(d => {
                  const v = dimVal(f, d.key)
                  const isGood = v != null && v >= 0.6
                  const isActive = activeDim === d.key
                  return (
                    <button key={d.key}
                      className={`ws-chip${isActive ? ' ws-chip-active' : ''}`}
                      onClick={() => { setActiveDim(isActive ? null : d.key); setActiveLabel(null) }}>
                      {d.label}
                      {v != null && (
                        <span className={`ws-chip-badge ${isGood ? 'ws-chip-badge-good' : 'ws-chip-badge-warn'}`}>
                          {Math.round(v * 100)}%
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {activeDim && <DimDetail dimKey={activeDim} f={f} isEmail={isEmail} activeLabel={activeLabel} onSelect={handleSubMetricSelect} response={session.response} prompt={session.prompt} />}
              <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '10px 0 0', lineHeight: 1.5 }}>
                These metrics measure linguistic surface features. Argument quality and communicative purpose are captured in the AI feedback below.
              </p>
            </div>
          </div>
        )}

        {/* 6. Grammar Mistakes */}
        {mistakes.length > 0 && (
          <div className="section-gap">
            <div className="section-title" style={{ marginTop: 0 }}>Grammar mistakes</div>
            <div className="table-card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ tableLayout: 'auto', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ whiteSpace: 'nowrap', width: '1%' }}>Type</th>
                    <th>Mistake</th>
                  </tr>
                </thead>
                <tbody>
                  {mistakes.map((m, i) => (
                    <tr key={m.id}
                      className="clickable-row"
                      onClick={() => router.push(`/dashboard/grammar/mistakes/${m.id}`)}
                      style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                      <td style={{ whiteSpace: 'nowrap', width: '1%', verticalAlign: 'middle' }}>
                        <span style={{
                          display: 'inline-block',
                          background: 'var(--teal-50)',
                          color: 'var(--teal-700)',
                          border: '1px solid var(--teal-200, #99d1d1)',
                          borderRadius: '999px',
                          padding: '0.1rem 0.55rem',
                          fontSize: '0.72rem',
                          fontWeight: 500,
                          lineHeight: 1.6,
                          whiteSpace: 'nowrap',
                        }}>{m.grammar_type}{m.sub_type ? ` · ${m.sub_type}` : ''}</span>
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--red)', fontStyle: 'italic' }}>✗ {m.wrong}</span>
                          <span style={{ color: '#9ca3af', fontWeight: 600 }}>→</span>
                          <span style={{ color: 'var(--green)' }}>✓ {m.correct}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 7. Feedback Grid */}
        {(strengths.length > 0 || improvements.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: '1.75rem' }}>
            {strengths.length > 0 && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '1.1rem 1.3rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>✓ What worked</div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#374151', fontSize: '0.88rem', lineHeight: 1.7 }}>
                  {strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {improvements.length > 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '1.1rem 1.3rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>✗ To fix next time</div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#374151', fontSize: '0.88rem', lineHeight: 1.7 }}>
                  {improvements.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 8. Actions */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: '2rem' }}>
          <button
            onClick={() => router.push(
              session.task_type === 'Write for an Academic Discussion'
                ? '/practice/writing/discussion'
                : '/practice/writing/email'
            )}
            className="btn-teal">
            {session.task_type === 'Write for an Academic Discussion'
              ? 'Practice discussion again'
              : 'Practice email again'}
          </button>
          <button
            onClick={() => {
              const typeSlug = session.task_type === 'Write for an Academic Discussion' ? 'discussion' : 'email'
              router.push(`/practice/writing/${typeSlug}/go?revision_of=${session.id}&prefill=${encodeURIComponent(session.response || '')}`)
            }}
            style={{ padding: '0.5rem 1rem', border: '1px solid #2a7a7a', background: 'white', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, color: '#2a7a7a', cursor: 'pointer' }}>
            Revise this response
          </button>
          <button onClick={() => router.push('/dashboard/writing')}
            style={{ padding: '0.5rem 1rem', border: '1px solid var(--border)', background: 'white', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
            All writing sessions
          </button>
        </div>

      </div>
    </div>
  )
}

export default function WritingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <RequireAuth><SessionDetailContent id={id} /></RequireAuth>
}
