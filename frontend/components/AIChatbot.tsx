'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPageContext(): string {
  if (typeof window === 'undefined') return ''
  const el =
    document.querySelector('main') ||
    (document.querySelector('[class*="writing-frame"]') as HTMLElement | null) ||
    document.body
  return (el as HTMLElement).innerText || ''
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22 }} aria-hidden="true">
      <path d="M12 2 L13.5 8.5 L20 10 L13.5 11.5 L12 18 L10.5 11.5 L4 10 L10.5 8.5 Z" />
      <path d="M19 2 L19.7 4.3 L22 5 L19.7 5.7 L19 8 L18.3 5.7 L16 5 L18.3 4.3 Z" />
      <path d="M5 16 L5.5 17.5 L7 18 L5.5 18.5 L5 20 L4.5 18.5 L3 18 L4.5 17.5 Z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }} aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" style={{ width: 16, height: 16 }} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }} aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  )
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }} aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </svg>
  )
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }} aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {on ? (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      ) : (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      )}
    </svg>
  )
}

function SpeakerSmallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }} aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }} aria-hidden="true">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }} aria-hidden="true">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="10" y1="14" x2="3" y2="21" />
      <line x1="21" y1="3" x2="14" y2="10" />
    </svg>
  )
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderInline(text: string, keyPrefix = ''): React.ReactNode[] {
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const raw = m[0]
    if (raw.startsWith('**')) {
      parts.push(<strong key={keyPrefix + k++} style={{ fontWeight: 700 }}>{m[2]}</strong>)
    } else if (raw.startsWith('*')) {
      parts.push(<em key={keyPrefix + k++}>{m[3]}</em>)
    } else {
      parts.push(
        <code key={keyPrefix + k++} style={{
          background: '#e8eaed', borderRadius: 4, padding: '1px 5px',
          fontSize: '0.8rem', fontFamily: 'monospace', color: '#1f2937',
        }}>{m[4]}</code>
      )
    }
    last = m.index + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let k = 0

  while (i < lines.length) {
    const line = lines[i]

    // ── Fenced code block ──
    if (line.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++
      blocks.push(
        <pre key={k++} style={{
          background: '#1e293b', color: '#e2e8f0',
          borderRadius: 8, padding: '10px 12px', margin: '6px 0',
          fontSize: '0.76rem', fontFamily: 'monospace',
          overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre',
        }}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      continue
    }

    // ── Table ──
    const trimmed = line.trim()
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\|[\s\-:| ]+\|/.test(lines[i + 1].trim())
    ) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      const parseRow = (row: string) =>
        row.split('|').slice(1, -1).map(c => c.trim())
      const headers = parseRow(tableLines[0])
      const bodyRows = tableLines.slice(2).map(parseRow)
      blocks.push(
        <div key={k++} style={{ overflowX: 'auto', margin: '6px 0', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr>
                {headers.map((h, j) => (
                  <th key={j} style={{
                    background: '#e5e7eb', border: '1px solid #d1d5db',
                    padding: '4px 8px', textAlign: 'left', fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}>
                    {renderInline(h, `th${j}-`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{
                      border: '1px solid #e5e7eb',
                      padding: '4px 8px', verticalAlign: 'top',
                    }}>
                      {renderInline(cell, `td${ri}-${ci}-`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // ── Heading ──
    const hMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (hMatch) {
      const level = hMatch[1].length
      const sizes = ['1rem', '0.92rem', '0.86rem']
      blocks.push(
        <div key={k++} style={{
          fontWeight: 700, fontSize: sizes[level - 1],
          color: '#111827', margin: '8px 0 2px',
          borderBottom: level === 1 ? '1px solid #e5e7eb' : undefined,
          paddingBottom: level === 1 ? 4 : undefined,
        }}>
          {renderInline(hMatch[2], `h${level}-${k}-`)}
        </div>
      )
      i++
      continue
    }

    // ── Unordered list ──
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={k++} style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.6 }}>
          {items.map((item, j) => (
            <li key={j} style={{ marginBottom: 2 }}>
              {renderInline(item, `ul${k}-${j}-`)}
            </li>
          ))}
        </ul>
      )
      continue
    }

    // ── Ordered list ──
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={k++} style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.6 }}>
          {items.map((item, j) => (
            <li key={j} style={{ marginBottom: 2 }}>
              {renderInline(item, `ol${k}-${j}-`)}
            </li>
          ))}
        </ol>
      )
      continue
    }

    // ── Empty line ──
    if (line.trim() === '') {
      blocks.push(<div key={k++} style={{ height: 6 }} />)
      i++
      continue
    }

    // ── Paragraph ──
    blocks.push(
      <p key={k++} style={{ margin: '2px 0', lineHeight: 1.6 }}>
        {renderInline(line, `p${k}-`)}
      </p>
    )
    i++
  }

  return <div style={{ fontSize: '0.84rem', color: '#1f2937', wordBreak: 'break-word' }}>{blocks}</div>
}

// ── Loading dots ──────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
      <style>{`
        @keyframes ai-dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        .ai-dot { width: 6px; height: 6px; border-radius: 50%; background: #6b7280; }
        .ai-dot:nth-child(1) { animation: ai-dot-bounce 1.2s 0s infinite; }
        .ai-dot:nth-child(2) { animation: ai-dot-bounce 1.2s 0.2s infinite; }
        .ai-dot:nth-child(3) { animation: ai-dot-bounce 1.2s 0.4s infinite; }
        @keyframes mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(192,57,43,0.5); }
          50% { box-shadow: 0 0 0 5px rgba(192,57,43,0); }
        }
      `}</style>
      <span className="ai-dot" />
      <span className="ai-dot" />
      <span className="ai-dot" />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const WELCOME: Message = {
  role: 'assistant',
  content: "Hi! I'm your TOEFL study assistant. Ask me anything about what's on this page — grammar rules, vocabulary, task strategy, or anything you don't understand.",
}

// Shared header button style
const hdrBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.12)',
  border: 'none',
  color: '#fff',
  borderRadius: 6,
  padding: '5px 7px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  marginLeft: 2,
}

export default function AIChatbot() {
  const { user } = useAuth()
  const pathname = usePathname()

  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Mic / voice input state ───────────────────────────────────────────────
  type MicState = 'idle' | 'recording' | 'transcribing'
  const [micState, setMicState] = useState<MicState>('idle')
  const [micError, setMicError] = useState('')

  // ── TTS state ─────────────────────────────────────────────────────────────
  const [ttsPlaying, setTtsPlaying] = useState(false)
  const [ttsPlayingIdx, setTtsPlayingIdx] = useState<number | null>(null)
  // AudioContext stays alive for the session — once unlocked by a user gesture
  // it can play audio at any time without triggering the autoplay policy.
  const audioCtxRef             = useRef<AudioContext | null>(null)
  const ttsSourceRef            = useRef<AudioBufferSourceNode | null>(null)   // full-WAV path
  const streamAbortRef          = useRef<AbortController | null>(null)          // streaming path
  const streamNodesRef          = useRef<AudioBufferSourceNode[]>([])           // streaming scheduled nodes

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Mic refs — kept outside state so handler closures always see current values
  const micRecorderRef = useRef<MediaRecorder | null>(null)
  const micChunksRef   = useRef<Blob[]>([])
  const micStreamRef   = useRef<MediaStream | null>(null)
  const micAutoSendRef = useRef(false)

  // Stable ref so the Ctrl+B keyboard effect (registered before early-return)
  // can always call the latest handleMicToggle without a stale closure
  const micToggleFnRef = useRef<(autoSend?: boolean) => Promise<void>>(async () => {})

  // Voice-activity waveform
  const MIC_BARS = 10
  const [vaBars, setVaBars]   = useState<number[]>(new Array(MIC_BARS).fill(0))
  const analyserRef  = useRef<AnalyserNode | null>(null)
  const vaRafRef     = useRef<number | null>(null)
  const vaDataRef    = useRef<Uint8Array<ArrayBuffer> | null>(null)

  // Hooks must run unconditionally — early return is AFTER all hooks
  useEffect(() => {
    if (!open) return
    setTimeout(() => textareaRef.current?.focus(), 80)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Push page content left when sidebar is expanded
  useEffect(() => {
    const body = document.body
    body.style.transition = 'padding-right 0.25s cubic-bezier(0.4,0,0.2,1)'
    if (open && expanded) {
      // sidebar width (400) + right inset (12) + gap (12) = 424px
      body.style.paddingRight = 'calc(min(400px, calc(100vw - 24px)) + 16px)'
    } else {
      body.style.paddingRight = ''
    }
    return () => {
      body.style.paddingRight = ''
    }
  }, [open, expanded])

  // ── Mic helpers ──────────────────────────────────────────────────────────

  function stopVA() {
    if (vaRafRef.current) { cancelAnimationFrame(vaRafRef.current); vaRafRef.current = null }
    analyserRef.current = null
    setVaBars(new Array(MIC_BARS).fill(0))
  }

  function startVA(stream: MediaStream) {
    try {
      const ctx      = new AudioContext()
      const src      = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      src.connect(analyser)
      analyserRef.current = analyser
      vaDataRef.current   = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
      const tick = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(vaDataRef.current!)
        const d    = vaDataRef.current!
        const step = Math.floor(d.length / MIC_BARS)
        setVaBars(Array.from({ length: MIC_BARS }, (_, i) => d[i * step] ?? 0))
        vaRafRef.current = requestAnimationFrame(tick)
      }
      vaRafRef.current = requestAnimationFrame(tick)
    } catch { /* AudioContext unavailable */ }
  }

  function stopMicStream() {
    stopVA()
    if (micRecorderRef.current?.state === 'recording') {
      micRecorderRef.current.stop()
    }
    micRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    micStreamRef.current = null
    micChunksRef.current = []
  }

  function getSupportedMime(): string {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
    for (const m of candidates) {
      if (!m || MediaRecorder.isTypeSupported(m)) return m
    }
    return ''
  }

  async function handleMicToggle(autoSend = false) {
    setMicError('')

    // Second press while recording — stop and transcribe
    if (micState === 'recording') {
      micAutoSendRef.current = autoSend
      const mr = micRecorderRef.current
      if (!mr) { setMicState('idle'); return }
      mr.onstop = async () => {
        const blob = new Blob(micChunksRef.current, { type: mr.mimeType || 'audio/webm' })
        stopMicStream()
        if (blob.size < 100) {
          setMicState('idle')
          setMicError('Recording empty — please try again')
          return
        }
        setMicState('transcribing')
        const fd = new FormData()
        fd.append('audio', blob, 'chat_voice.webm')
        try {
          const res = await fetch('/api/chat/transcribe', {
            method: 'POST',
            body: fd,
            credentials: 'include',
          })
          const data = await res.json()
          if (!res.ok || data.error) {
            setMicError(data.error || 'Transcription failed')
            setMicState('idle')
          } else {
            const transcribed = (data.text || '').trim()
            if (!transcribed) {
              setMicError('No speech detected — please try again')
              setMicState('idle')
            } else if (micAutoSendRef.current) {
              // Auto-send: call handleSend directly with the transcribed text
              setMicState('idle')
              handleSend(transcribed)
            } else {
              setInput((prev: string) => prev ? prev + ' ' + transcribed : transcribed)
              setMicState('idle')
              setTimeout(() => textareaRef.current?.focus(), 50)
            }
          }
        } catch {
          setMicError('Transcription failed — please type your message')
          setMicState('idle')
        }
      }
      mr.stop()
      return
    }

    // First press — start recording
    if (micState !== 'idle') return
    micAutoSendRef.current = autoSend
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      const mime = getSupportedMime()
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      micChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) micChunksRef.current.push(e.data) }
      mr.start(100)
      micRecorderRef.current = mr
      startVA(stream)
      setMicState('recording')
    } catch {
      setMicError('Microphone access denied — please allow mic permission')
      setMicState('idle')
    }
  }

  // Keep ref in sync so Ctrl+B handler always has the latest function
  micToggleFnRef.current = handleMicToggle

  // ── TTS helpers ───────────────────────────────────────────────────────────

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }

  function stopTTS() {
    // Stop full-WAV playback
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.stop() } catch { /* already stopped */ }
      ttsSourceRef.current = null
    }
    // Abort streaming fetch + stop all scheduled stream nodes
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    streamNodesRef.current.forEach((n: AudioBufferSourceNode) => { try { n.stop() } catch { /* ok */ } })
    streamNodesRef.current = []
    setTtsPlaying(false)
    setTtsPlayingIdx(null)
  }

  // ── Streaming TTS (auto-play) ───────────────────────────────────────────
  // Parses the framed float32 protocol and schedules chunks into AudioContext
  // as they arrive, so playback starts in ~300ms and continues gaplessly.

  async function speakMessageStream(text: string, idx: number | null = null) {
    stopTTS()
    setTtsPlaying(true)
    setTtsPlayingIdx(idx)

    const abort = new AbortController()
    streamAbortRef.current = abort

    try {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') await ctx.resume()

      const res = await fetch('/api/chat/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, voice: 'anna' }),
        signal: abort.signal,
      })
      if (!res.ok || !res.body) { stopTTS(); return }

      const reader = res.body.getReader()
      let buf = new Uint8Array(0)
      let sampleRate = 0
      let nextStartTime = 0  // AudioContext time to schedule next chunk

      const appendBuf = (chunk: Uint8Array) => {
        const merged = new Uint8Array(buf.length + chunk.length)
        merged.set(buf); merged.set(chunk, buf.length)
        buf = merged
      }

      while (true) {
        const { done, value } = await reader.read()
        if (abort.signal.aborted) break
        if (value) appendBuf(value)
        if (done && buf.length === 0) break

        // Parse as many complete frames as possible from the buffer
        let offset = 0
        while (true) {
          // Need at least 4 bytes for header
          if (buf.length - offset < 4) break
          const view = new DataView(buf.buffer, buf.byteOffset + offset)

          if (sampleRate === 0) {
            // First 4 bytes = sample rate
            sampleRate = view.getUint32(0, true)
            offset += 4
            continue
          }

          // Next 4 bytes = chunk length in samples
          if (buf.length - offset < 4) break
          const nSamples = view.getUint32(0, true)
          if (nSamples === 0) { offset += 4; break }

          // Then nSamples × 4 bytes of float32
          const byteLen = nSamples * 4
          if (buf.length - offset < 4 + byteLen) break

          const floatView = new Float32Array(
            buf.buffer, buf.byteOffset + offset + 4, nSamples
          )
          const floatCopy = new Float32Array(floatView)  // copy — detach from original
          offset += 4 + byteLen

          // Schedule this chunk for gapless playback
          const audioBuf = ctx.createBuffer(1, nSamples, sampleRate)
          audioBuf.copyToChannel(floatCopy, 0)
          const node = ctx.createBufferSource()
          node.buffer = audioBuf
          node.connect(ctx.destination)
          const now = ctx.currentTime
          const when = Math.max(now, nextStartTime)
          nextStartTime = when + audioBuf.duration
          node.start(when)
          streamNodesRef.current.push(node)

          // Last scheduled node marks the end
          node.onended = () => {
            if (streamNodesRef.current.length > 0 &&
                node === streamNodesRef.current[streamNodesRef.current.length - 1]) {
              setTtsPlaying(false)
              setTtsPlayingIdx(null)
              streamNodesRef.current = []
            }
          }
        }

        // Keep only unconsumed bytes
        if (offset > 0) {
          buf = buf.slice(offset)
        }
        if (done) break
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') stopTTS()
    }
  }

  // ── Full-WAV TTS (manual replay button) ─────────────────────────────────

  async function speakMessage(text: string, idx: number | null = null) {
    stopTTS()
    setTtsPlaying(true)
    setTtsPlayingIdx(idx)
    try {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') await ctx.resume()

      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, voice: 'anna' }),
      })
      if (!res.ok) { stopTTS(); return }

      const arrayBuf = await res.arrayBuffer()
      const audioBuf = await ctx.decodeAudioData(arrayBuf)
      const source = ctx.createBufferSource()
      source.buffer = audioBuf
      source.connect(ctx.destination)
      source.onended = () => { stopTTS() }
      ttsSourceRef.current = source
      source.start(0)
    } catch {
      stopTTS()
    }
  }

  // Stop mic + TTS when chatbot closes or component unmounts
  useEffect(() => {
    if (!open) {
      stopMicStream()
      stopTTS()
    }
  }, [open])

  useEffect(() => {
    return () => {
      stopMicStream()
      stopTTS()
      audioCtxRef.current?.close().catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ctrl+B — toggle mic from anywhere on the page when chatbot is open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!open) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        // autoSend=true so second Ctrl+B sends immediately
        micToggleFnRef.current(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!user || pathname === '/login') return null

  async function handleSend(directText?: string) {
    const text = (directText ?? input).trim()
    if (!text || loading) return

    // Unlock / resume AudioContext NOW — this is still inside the user gesture.
    // Once unlocked it can play audio at any later time (after LLM + TTS fetches).
    try {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') await ctx.resume()
    } catch { /* AudioContext not available in this browser */ }

    const context = getPageContext()
    const userMsg: Message = { role: 'user', content: text }
    const next = [...messages, userMsg]
    setMessages(next)
    if (!directText) setInput('')
    setError('')
    setLoading(true)

    const history = next.filter(m => !(m.role === 'assistant' && m.content === WELCOME.content))
    const replyIdx = next.length

    try {
      const res = await api.post<{ reply: string }>('/api/chat', { messages: history, context })
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply }])
      // Auto-play: speak only the first 2 sentences for low latency.
      // Shorter text = much faster TTS on this CPU (~1-2s vs 10s+ for full reply).
      // The speaker button below the message plays the full text on demand.
      const firstTwo = res.reply
        .split(/(?<=[.!?])\s+/)
        .slice(0, 2)
        .join(' ')
        .trim()
      speakMessageStream(firstTwo || res.reply, replyIdx)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleClear() {
    setMessages([WELCOME])
    setError('')
    textareaRef.current?.focus()
  }

  function handleExpand() {
    setExpanded(e => !e)
  }

  // ── Panel styles — normal popup vs expanded sidebar ──────────────────────────

  const panelStyle: React.CSSProperties = expanded
    ? {
        position: 'fixed',
        top: 12,
        bottom: 12,
        right: 12,
        width: 'min(400px, calc(100vw - 24px))',
        height: 'auto',
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 9999,
        border: '1px solid #e5e7eb',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }
    : {
        position: 'fixed',
        bottom: 88,
        right: 24,
        width: 'min(320px, calc(100vw - 32px))',
        height: 'min(480px, calc(100vh - 120px))',
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 9999,
        border: '1px solid #e5e7eb',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }

  const toggleBtnStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #2c7873, #173f3b)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    display: expanded ? 'none' : 'flex', // hide toggle when sidebar is open
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
    zIndex: 9998,
    transition: 'transform 0.15s, box-shadow 0.15s',
  }

  const headerStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, #2c7873, #173f3b)',
    color: '#fff',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  }

  const messagesAreaStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  }

  const inputRowStyle: React.CSSProperties = {
    position: 'relative',
    padding: '8px 10px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    gap: 6,
    alignItems: 'flex-end',
    flexShrink: 0,
    background: '#f9fafb',
  }

  return (
    <>
      {/* ── Chat panel ── */}
      {open && (
        <div style={panelStyle} role="dialog" aria-label="AI Study Assistant">

          {/* Header */}
          <div style={headerStyle}>
            <SparkleIcon />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>AI Study Assistant</div>
              <div style={{ fontSize: '0.7rem', opacity: 0.75 }}>Ask about anything on this page</div>
            </div>

            {/* Expand / collapse sidebar button */}
            <button
              onClick={handleExpand}
              title={expanded ? 'Collapse to popup' : 'Expand to sidebar'}
              aria-label={expanded ? 'Collapse to popup' : 'Expand to sidebar'}
              style={hdrBtn}
            >
              {expanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>

            {/* Clear */}
            <button onClick={handleClear} title="Clear chat" aria-label="Clear chat history" style={hdrBtn}>
              <TrashIcon />
            </button>

            {/* Close */}
            <button
              onClick={() => { setOpen(false); setExpanded(false) }}
              aria-label="Close chat"
              style={hdrBtn}
            >
              <CloseIcon />
            </button>
          </div>

          {/* Messages */}
          <div style={messagesAreaStyle}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 2 }}>
                <div style={{
                  maxWidth: expanded ? '90%' : '82%',
                  padding: '8px 12px',
                  borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: m.role === 'user' ? '#2a7a7a' : '#f3f4f6',
                  color: m.role === 'user' ? '#fff' : '#1f2937',
                  fontSize: '0.84rem',
                  lineHeight: 1.55,
                  whiteSpace: m.role === 'user' ? 'pre-wrap' : undefined,
                  wordBreak: 'break-word',
                }}>
                  {m.role === 'user' ? m.content : <MarkdownRenderer content={m.content} />}
                </div>
                {/* Speaker button — assistant messages only */}
                {m.role === 'assistant' && m.content !== WELCOME.content && (() => {
                  const lastAssistantIdx = messages.reduce((acc: number, msg: Message, idx: number) => msg.role === 'assistant' ? idx : acc, -1)
                  const isNewest = i === lastAssistantIdx
                  const isActive = ttsPlayingIdx === i
                  return (
                    <button
                      onClick={() => isActive ? stopTTS() : speakMessage(m.content, i)}
                      title={isActive ? 'Stop speaking' : 'Play reply aloud'}
                      aria-label={isActive ? 'Stop speaking' : 'Play reply aloud'}
                      style={{
                        background: isActive ? '#fef2f2' : isNewest ? '#f0faf8' : 'none',
                        border: isActive ? '1px solid #fecaca' : isNewest ? '1px solid #c5dedd' : 'none',
                        cursor: 'pointer',
                        color: isActive ? '#c0392b' : isNewest ? '#2a7a7a' : '#9ca3af',
                        padding: '2px 7px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: '0.68rem',
                        borderRadius: 6,
                        transition: 'all 0.15s',
                        fontFamily: 'inherit',
                      }}
                    >
                      {isActive
                        ? <><span style={{ fontSize: 9 }}>■</span> stop</>
                        : <><SpeakerSmallIcon /> {isNewest ? 'play' : ''}</>
                      }
                    </button>
                  )
                })()}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '8px 14px', borderRadius: '14px 14px 14px 4px', background: '#f3f4f6' }}>
                  <TypingDots />
                </div>
              </div>
            )}

            {error && (
              <div style={{
                fontSize: '0.78rem', color: '#dc2626',
                padding: '6px 10px', background: '#fef2f2',
                borderRadius: 8, border: '1px solid #fecaca',
              }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={inputRowStyle}>
            {/* Waveform bars — visible only while recording */}
            {micState === 'recording' && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: 0, right: 0,
                height: 36,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                gap: 3,
                padding: '0 10px 4px',
                background: 'linear-gradient(to bottom, transparent, rgba(249,250,251,0.95))',
                pointerEvents: 'none',
              }}>
                {vaBars.map((level: number, j: number) => {
                  const h = Math.max(3, Math.round((level / 255) * 26))
                  return (
                    <div key={j} style={{
                      width: 4, height: h, borderRadius: 3,
                      background: `rgba(192,57,43,${0.5 + (level / 255) * 0.5})`,
                      transition: 'height 0.06s ease-out',
                    }} />
                  )
                })}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={micState === 'recording' ? 'Listening… press Ctrl+B to send' : micState === 'transcribing' ? 'Transcribing…' : 'Ask a question… (Enter to send, Ctrl+B for voice)'}
              rows={1}
              disabled={loading || micState === 'transcribing'}
              aria-label="Chat message input"
              style={{
                flex: 1,
                resize: 'none',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                padding: '6px 9px',
                fontSize: '0.82rem',
                lineHeight: 1.5,
                outline: 'none',
                fontFamily: 'inherit',
                background: micState === 'recording' ? '#fff5f5' : '#fff',
                color: '#1f2937',
                transition: 'border-color 0.15s, background 0.15s',
                maxHeight: 80,
                overflowY: 'auto',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#2a7a7a' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#d1d5db' }}
            />
            {/* Mic button */}
            <button
              onClick={() => handleMicToggle(false)}
              disabled={loading}
              aria-label={micState === 'recording' ? 'Stop recording' : micState === 'transcribing' ? 'Transcribing…' : 'Record voice message'}
              title={micState === 'recording' ? 'Stop recording' : micState === 'transcribing' ? 'Transcribing…' : 'Voice input'}
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                flexShrink: 0,
                background: micState === 'recording'
                  ? '#c0392b'
                  : micState === 'transcribing'
                    ? '#b8860b'
                    : '#f3f4f6',
                color: micState === 'idle' ? '#6b7280' : '#fff',
                border: micState === 'idle' ? '1px solid #d1d5db' : 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s',
                animation: micState === 'recording' ? 'mic-pulse 1.2s ease-in-out infinite' : 'none',
              }}
            >
              {micState === 'transcribing'
                ? <span style={{ fontSize: 11 }}>…</span>
                : <MicIcon active={micState === 'recording'} />
              }
            </button>
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              aria-label="Send message"
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                flexShrink: 0,
                background: !input.trim() || loading ? '#e5e7eb' : 'linear-gradient(135deg, #2c7873, #173f3b)',
                color: !input.trim() || loading ? '#9ca3af' : '#fff',
                border: 'none',
                cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s',
              }}
            >
              <SendIcon />
            </button>
          </div>
          {/* Mic error */}
          {micError && (
            <div style={{
              fontSize: '0.72rem', color: '#b45309',
              padding: '4px 10px 6px',
              background: '#fffbeb',
              borderTop: '1px solid #fde68a',
              flexShrink: 0,
            }}>
              {micError}
            </div>
          )}
        </div>
      )}

      {/* ── Toggle button (hidden when sidebar is open) ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={toggleBtnStyle}
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
        aria-expanded={open}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'
          ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.28)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
          ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.22)'
        }}
      >
        {open ? <CloseIcon /> : <SparkleIcon />}
      </button>
    </>
  )
}
