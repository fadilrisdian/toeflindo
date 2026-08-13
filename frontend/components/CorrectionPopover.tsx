'use client'
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

// ── Word-level diff ───────────────────────────────────────────────────────────

/**
 * Finds the minimal changed span by comparing word-by-word.
 * Returns the wrong fragment, its correct replacement, and the surrounding context.
 * Returns null when the two strings are identical.
 */
export function findDiffSpan(
  wrong: string,
  correct: string
): { pre: string; highlight: string; correctFragment: string; post: string } | null {
  const wWords = wrong.trim().split(/\s+/)
  const cWords = correct.trim().split(/\s+/)

  // Walk from left
  let start = 0
  while (
    start < wWords.length &&
    start < cWords.length &&
    wWords[start].toLowerCase() === cWords[start].toLowerCase()
  ) { start++ }

  // Walk from right
  let endW = wWords.length - 1
  let endC = cWords.length - 1
  while (
    endW >= start &&
    endC >= start &&
    wWords[endW].toLowerCase() === cWords[endC].toLowerCase()
  ) { endW--; endC-- }

  if (start > endW) {
    // wrong is exhausted but correct has extra inserted words
    if (start <= endC) {
      return {
        pre:             wWords.slice(0, start).join(' '),
        highlight:       '',
        correctFragment: cWords.slice(start, endC + 1).join(' '),
        post:            '',
      }
    }
    return null // identical
  }

  return {
    pre:             wWords.slice(0, start).join(' '),
    highlight:       wWords.slice(start, endW + 1).join(' '),
    correctFragment: cWords.slice(start, endC + 1).join(' '),
    post:            wWords.slice(endW + 1).join(' '),
  }
}

// ── Single-phrase hover popover ───────────────────────────────────────────────

interface PopoverProps {
  /** The wrong fragment shown under "Language Use" */
  original: string
  /** The correct replacement shown under "Try Instead" */
  correction: string
  explanation?: string
  children: React.ReactNode
}

/**
 * Wraps children with a wavy red underline.
 * On hover a popover is portalled to document.body with fixed positioning
 * so it never gets clipped by overflow:hidden ancestors (tables, modals, etc).
 */
export function CorrectionPopover({ original, correction, explanation, children }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)

  function handleMouseEnter() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setCoords({
        top: rect.top - 10,                  // viewport-relative, no scrollY needed for fixed
        left: rect.left + rect.width / 2,
      })
    }
    setOpen(true)
  }

  const popover = open && typeof document !== 'undefined' ? createPortal(
    <span
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        transform: 'translateX(-50%) translateY(-100%)',
        background: '#1f2937',
        color: '#fff',
        borderRadius: 10,
        padding: '10px 14px',
        minWidth: 220,
        maxWidth: 300,
        zIndex: 99999,
        boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: 'normal',
        pointerEvents: 'none',
        display: 'block',
      }}
    >
      {/* Arrow */}
      <span
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid #1f2937',
          display: 'block',
        }}
      />

      <span style={{ display: 'block', marginBottom: 7 }}>
        <span style={{ display: 'block', color: '#9ca3af', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
          Language Use
        </span>
        <span style={{ color: '#fca5a5' }}>{original}</span>
      </span>

      <span style={{ display: 'block' }}>
        <span style={{ display: 'block', color: '#9ca3af', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
          Try Instead
        </span>
        <span style={{ color: '#86efac' }}>{correction}</span>
      </span>

      {explanation && (
        <span style={{ display: 'block', marginTop: 7, borderTop: '1px solid #374151', paddingTop: 6, color: '#d1d5db', fontSize: 11 }}>
          {explanation}
        </span>
      )}
    </span>,
    document.body
  ) : null

  return (
    <span
      ref={triggerRef}
      style={{ position: 'relative', display: 'inline' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        style={{
          textDecoration: 'underline',
          textDecorationStyle: 'wavy',
          textDecorationColor: '#ef4444',
          cursor: 'help',
        }}
      >
        {children}
      </span>
      {popover}
    </span>
  )
}

// ── Annotated sentence (grammar cards, dashboard tables) ──────────────────────

interface SentenceProps {
  wrong: string
  correct: string
  explanation?: string
  style?: React.CSSProperties
  /** When false, renders the wrong sentence as plain text with no underline or popover. Default: true */
  showHighlight?: boolean
}

/**
 * Renders the full `wrong` sentence but underlines only the changed fragment.
 * Uses word-level diff — no LLM needed.
 * Falls back to underlining the whole sentence if no diff is found.
 */
export function AnnotatedSentence({ wrong, correct, explanation, style, showHighlight = true }: SentenceProps) {
  const diff = findDiffSpan(wrong, correct)

  if (!showHighlight || !diff) {
    // No highlight requested, or sentences are identical — render plain
    return <span style={style}>{wrong}</span>
  }

  const { pre, highlight, correctFragment, post } = diff

  // Insertion-only diff: wrong is shorter than correct, highlight is empty.
  // Show the correct insertion in the popover anchored to the last pre-word.
  if (!highlight) {
    return (
      <span style={style}>
        {pre && <>{pre} </>}
        <CorrectionPopover original="(missing)" correction={correctFragment} explanation={explanation}>
          <span style={{ textDecoration: 'underline', textDecorationStyle: 'wavy', textDecorationColor: '#ef4444', cursor: 'help' }}>∅</span>
        </CorrectionPopover>
        {post && <> {post}</>}
      </span>
    )
  }

  return (
    <span style={style}>
      {pre && <>{pre} </>}
      <CorrectionPopover original={highlight} correction={correctFragment} explanation={explanation}>
        {highlight}
      </CorrectionPopover>
      {post && <> {post}</>}
    </span>
  )
}

// ── Annotated transcript (speech analyzer) ────────────────────────────────────

interface Correction {
  original: string
  correct: string
  explanation?: string
}

interface AnnotatedProps {
  text: string
  corrections: Correction[]
  style?: React.CSSProperties
}

/**
 * Renders a transcript with inline hover popovers on only the changed words.
 * For each correction, finds `original` in the transcript, then diffs it against
 * `correct` to underline just the wrong fragment within that phrase.
 */
export function AnnotatedTranscript({ text, corrections, style }: AnnotatedProps) {
  if (!corrections.length) return <span style={style}>{text}</span>

  type Region = {
    start: number
    end: number
    pre: string
    highlight: string
    correctFragment: string
    post: string
    explanation?: string
  }

  const regions: Region[] = []

  for (const c of corrections) {
    if (!c.original) continue
    // Find all non-overlapping occurrences of this correction in the text
    const lowerText = text.toLowerCase()
    const lowerOrig = c.original.toLowerCase()
    let searchFrom = 0
    while (searchFrom < lowerText.length) {
      const idx = lowerText.indexOf(lowerOrig, searchFrom)
      if (idx === -1) break
      const overlaps = regions.some(r => idx < r.end && idx + c.original.length > r.start)
      if (!overlaps) {
        // Diff within the matched phrase to find only the wrong fragment
        const diff = findDiffSpan(c.original, c.correct)
        if (diff) {
          regions.push({
            start: idx,
            end: idx + c.original.length,
            pre: diff.pre,
            highlight: diff.highlight,
            correctFragment: diff.correctFragment,
            post: diff.post,
            explanation: c.explanation,
          })
        }
      }
      searchFrom = idx + c.original.length
    }
  }

  regions.sort((a, b) => a.start - b.start)

  if (!regions.length) return <span style={style}>{text}</span>

  const nodes: React.ReactNode[] = []
  let cursor = 0

  for (const r of regions) {
    if (cursor < r.start) nodes.push(text.slice(cursor, r.start))
    // Reconstruct the matched phrase with only the diff part underlined
    if (r.pre) nodes.push(r.pre + ' ')
    nodes.push(
      <CorrectionPopover
        key={r.start}
        original={r.highlight}
        correction={r.correctFragment}
        explanation={r.explanation}
      >
        {r.highlight}
      </CorrectionPopover>
    )
    if (r.post) nodes.push(' ' + r.post)
    cursor = r.end
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))

  return <span style={style}>{nodes}</span>
}
