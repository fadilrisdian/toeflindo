'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

// ── Types ─────────────────────────────────────────────────────────────────────

type VSMode = 'idle' | 'listening' | 'thinking' | 'speaking'

interface Msg { role: 'user' | 'assistant'; content: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const MIC_BARS = 14
const MAX_CONTEXT_CHARS = 3000
const WELCOME_MSG: Msg = {
  role: 'assistant',
  content: "Hi! I'm your TOEFL study assistant. Ask me anything about what's on this page.",
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPageContext(): string {
  if (typeof window === 'undefined') return ''
  const el = document.querySelector('main') || document.body
  return ((el as HTMLElement).innerText || '').slice(0, MAX_CONTEXT_CHARS)
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
}

function getSupportedMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
  for (const m of candidates) {
    if (!m || MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

// ── SparkleIcon ───────────────────────────────────────────────────────────────

function SparkleIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size, height: size }} aria-hidden="true">
      <path d="M12 2 L13.5 8.5 L20 10 L13.5 11.5 L12 18 L10.5 11.5 L4 10 L10.5 8.5 Z" />
      <path d="M19 2 L19.7 4.3 L22 5 L19.7 5.7 L19 8 L18.3 5.7 L16 5 L18.3 4.3 Z" />
      <path d="M5 16 L5.5 17.5 L7 18 L5.5 18.5 L5 20 L4.5 18.5 L3 18 L4.5 17.5 Z" />
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VoiceSpeakingMode() {
  const { user } = useAuth()
  const pathname = usePathname()

  const [mode, setMode] = useState<VSMode>('idle')
  const [subtitle, setSubtitle] = useState('')
  const [cursorOn, setCursorOn] = useState(true)
  const [vaBars, setVaBars] = useState<number[]>(new Array(MIC_BARS).fill(0))
  const [chatbotOpen, setChatbotOpen] = useState(false)
  const [micError, setMicError] = useState('')
  const [messages, setMessages] = useState<Msg[]>([WELCOME_MSG])

  // ── Audio refs ────────────────────────────────────────────────────────────
  const audioCtxRef    = useRef<AudioContext | null>(null)
  const micRecorderRef = useRef<MediaRecorder | null>(null)
  const micChunksRef   = useRef<Blob[]>([])
  const micStreamRef   = useRef<MediaStream | null>(null)
  const analyserRef    = useRef<AnalyserNode | null>(null)
  const vaRafRef       = useRef<number | null>(null)
  const vaDataRef      = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamNodesRef = useRef<AudioBufferSourceNode[]>([])
  const ttsNextTimeRef = useRef(0)
  const wordTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([])
  const idleRafRef     = useRef<number | null>(null)
  const idlePhaseRef   = useRef(0)

  // Stable ref so keyboard handlers always see latest mode without stale closures
  const modeRef = useRef<VSMode>('idle')
  modeRef.current = mode
  const submitFnRef = useRef<() => Promise<void>>(async () => {})

  // ── Track chatbot sidebar state ───────────────────────────────────────────
  useEffect(() => {
    const onOpen  = () => setChatbotOpen(true)
    const onClose = () => setChatbotOpen(false)
    window.addEventListener('chatbot-open', onOpen)
    window.addEventListener('chatbot-close', onClose)
    return () => {
      window.removeEventListener('chatbot-open', onOpen)
      window.removeEventListener('chatbot-close', onClose)
    }
  }, [])

  // ── Blinking cursor ───────────────────────────────────────────────────────
  useEffect(() => {
    if (mode === 'idle') return
    const id = setInterval(() => setCursorOn(v => !v), 530)
    return () => clearInterval(id)
  }, [mode])

  // ── VA helpers ────────────────────────────────────────────────────────────
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
    } catch { /* no AudioContext */ }
  }

  // Idle sine-wave animation when thinking/speaking (no real audio data)
  function startIdleAnim() {
    stopIdleAnim()
    const tick = () => {
      idlePhaseRef.current += 0.08
      const phase = idlePhaseRef.current
      setVaBars(Array.from({ length: MIC_BARS }, (_, i) => {
        const v = Math.sin(phase + i * 0.5) * 0.5 + 0.5
        return Math.round(v * 90 + 20)
      }))
      idleRafRef.current = requestAnimationFrame(tick)
    }
    idleRafRef.current = requestAnimationFrame(tick)
  }

  function stopIdleAnim() {
    if (idleRafRef.current) { cancelAnimationFrame(idleRafRef.current); idleRafRef.current = null }
  }

  // ── Audio context ─────────────────────────────────────────────────────────
  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }

  // ── Stop TTS ──────────────────────────────────────────────────────────────
  function stopTTS() {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    streamNodesRef.current.forEach(n => { try { n.stop() } catch { /* ok */ } })
    streamNodesRef.current = []
    ttsNextTimeRef.current = 0
    wordTimersRef.current.forEach(clearTimeout)
    wordTimersRef.current = []
    stopIdleAnim()
  }

  // ── Stop mic ──────────────────────────────────────────────────────────────
  function stopMicStream() {
    stopVA()
    if (micRecorderRef.current?.state === 'recording') micRecorderRef.current.stop()
    micRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    micStreamRef.current = null
    micChunksRef.current = []
  }

  // ── TTS: speak a sentence, return when scheduled, reveal words in sync ────
  async function speakSentenceVSM(
    sentence: string,
    onProgress: (partial: string) => void,
    onSentenceDone: () => void,
  ): Promise<void> {
    const abort = streamAbortRef.current
    const words = sentence.split(/\s+/).filter(Boolean)
    if (words.length === 0) { onProgress(sentence); onSentenceDone(); return }

    try {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') await ctx.resume()

      const res = await fetch('/api/chat/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: sentence, voice: 'anna' }),
        signal: abort?.signal,
      })
      if (!res.ok || !res.body) { onProgress(sentence); onSentenceDone(); return }
      if (abort?.signal.aborted) return

      const reader   = res.body.getReader()
      let buf        = new Uint8Array(0)
      let sampleRate = 0
      const frames: Float32Array<ArrayBuffer>[] = []

      const appendBuf = (chunk: Uint8Array) => {
        const merged = new Uint8Array(buf.length + chunk.length)
        merged.set(buf); merged.set(chunk, buf.length)
        buf = merged
      }

      while (true) {
        const { done, value } = await reader.read()
        if (abort?.signal.aborted) break
        if (value) appendBuf(value)

        let offset = 0
        while (true) {
          if (buf.length - offset < 4) break
          const view = new DataView(buf.buffer, buf.byteOffset + offset)
          if (sampleRate === 0) { sampleRate = view.getUint32(0, true); offset += 4; continue }
          if (buf.length - offset < 4) break
          const nSamples = view.getUint32(0, true)
          if (nSamples === 0) { offset += 4; break }
          const byteLen = nSamples * 4
          if (buf.length - offset < 4 + byteLen) break
          const raw = new Float32Array(buf.buffer, buf.byteOffset + offset + 4, nSamples)
          const copy = new Float32Array(nSamples)
          copy.set(raw)
          frames.push(copy)
          offset += 4 + byteLen
        }
        if (offset > 0) buf = buf.slice(offset)
        if (done) break
      }

      if (abort?.signal.aborted || frames.length === 0 || sampleRate === 0) {
        onProgress(sentence); onSentenceDone(); return
      }

      // Schedule all frames gaplessly on shared timeline
      const now       = ctx.currentTime
      const startWhen = Math.max(now, ttsNextTimeRef.current)
      let cursor      = startWhen

      for (const frame of frames) {
        const ab   = ctx.createBuffer(1, frame.length, sampleRate)
        ab.copyToChannel(frame, 0)
        const node = ctx.createBufferSource()
        node.buffer = ab
        node.connect(ctx.destination)
        node.start(cursor)
        cursor += ab.duration
        streamNodesRef.current.push(node)
        node.onended = () => {
          const nodes = streamNodesRef.current
          if (nodes.length > 0 && node === nodes[nodes.length - 1]) {
            streamNodesRef.current = []
          }
        }
      }
      ttsNextTimeRef.current = cursor

      const totalMs  = (cursor - startWhen) * 1000
      const delayMs  = Math.max(0, (startWhen - now) * 1000)

      // Word-by-word reveal proportionally across sentence duration
      words.forEach((_, i) => {
        const t = delayMs + (i / words.length) * totalMs
        const partial = words.slice(0, i + 1).join(' ')
        const timer = setTimeout(() => onProgress(partial), Math.max(0, t))
        wordTimersRef.current.push(timer)
      })

      // When last word is scheduled to finish playing, call onSentenceDone
      const sentenceEndTimer = setTimeout(onSentenceDone, Math.max(0, delayMs + totalMs))
      wordTimersRef.current.push(sentenceEndTimer)

    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        onProgress(sentence)
        onSentenceDone()
      }
    }
  }

  // ── Start mic recording ───────────────────────────────────────────────────
  async function startListening() {
    setMicError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      const mime = getSupportedMime()
      const mr   = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      micChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) micChunksRef.current.push(e.data) }
      mr.start(100)
      micRecorderRef.current = mr
      startVA(stream)
      setMode('listening')
    } catch {
      setMicError('Microphone access denied')
      setMode('idle')
    }
  }

  // ── Submit: stop mic → transcribe → LLM → TTS ────────────────────────────
  async function submitVoice() {
    if (modeRef.current !== 'listening') return
    setMode('thinking')
    stopVA()
    startIdleAnim()

    const mr = micRecorderRef.current
    if (!mr) { setMode('listening'); await startListening(); return }

    mr.onstop = async () => {
      const blob = new Blob(micChunksRef.current, { type: mr.mimeType || 'audio/webm' })
      stopMicStream()
      if (blob.size < 100) {
        setMode('listening'); await startListening(); return
      }

      // Transcribe
      const fd = new FormData()
      fd.append('audio', blob, 'vs_voice.webm')
      let transcript = ''
      try {
        const tr = await fetch('/api/chat/transcribe', {
          method: 'POST', body: fd, credentials: 'include',
        })
        const td = await tr.json()
        transcript = (td.text || '').trim()
      } catch { /* ignore */ }

      if (!transcript) {
        setSubtitle(''); setMode('listening'); await startListening(); return
      }

      // LLM
      const userMsg: Msg = { role: 'user', content: transcript }
      const history = [...messages.filter(m => !(m.role === 'assistant' && m.content === WELCOME_MSG.content)), userMsg]
      setMessages(prev => [...prev, userMsg])

      const context = getPageContext()
      let reply = ''
      try {
        const abort = new AbortController()
        streamAbortRef.current = abort
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ messages: history, context, tts_mode: true }),
          signal: abort.signal,
        })
        const data = await res.json()
        reply = (data.reply || '').trim()
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return
        setMode('listening'); await startListening(); return
      }

      if (!reply) { setMode('listening'); await startListening(); return }

      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
      setMode('speaking')
      stopIdleAnim()

      const sentences = splitSentences(reply)
      for (let i = 0; i < sentences.length; i++) {
        if (modeRef.current !== 'speaking') break
        const sentence = sentences[i]

        await new Promise<void>(resolve => {
          setSubtitle('')   // clear previous sentence
          speakSentenceVSM(
            sentence,
            (partial) => {
              if (modeRef.current === 'speaking') setSubtitle(partial)
            },
            resolve,
          )
        })
      }

      // Done speaking — ready for next input
      if (modeRef.current === 'speaking') {
        setSubtitle('')
        stopIdleAnim()
        setMode('listening')
        await startListening()
      }
    }

    if (mr.state === 'recording') mr.stop()
  }

  submitFnRef.current = submitVoice

  // ── Exit Speaking Mode ────────────────────────────────────────────────────
  const exitMode = useCallback(() => {
    stopMicStream()
    stopTTS()
    setMode('idle')
    setSubtitle('')
    setVaBars(new Array(MIC_BARS).fill(0))
    setMicError('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Global keyboard handler ───────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Esc: always exits
      if (e.key === 'Escape' && modeRef.current !== 'idle') {
        e.preventDefault()
        exitMode()
        return
      }

      if (!((e.ctrlKey || e.metaKey) && e.key === 'b')) return

      // If chatbot sidebar is open, don't intercept — let AIChatbot handle it
      // (AIChatbot's own handler only fires when its panel is open)
      if (chatbotOpen) return

      e.preventDefault()

      if (modeRef.current === 'idle') {
        // Enter speaking mode
        setMode('listening')
        startListening()
      } else {
        // Exit speaking mode
        exitMode()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotOpen, exitMode])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopMicStream()
      stopTTS()
      audioCtxRef.current?.close().catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Don't render on login page or when not authenticated
  if (!user || pathname === '/login' || mode === 'idle') return null

  // ── Derived values ────────────────────────────────────────────────────────
  const statusLabel =
    mode === 'listening' ? 'Listening' :
    mode === 'thinking'  ? 'Thinking…' :
    mode === 'speaking'  ? 'Speaking'  : ''

  const logoColor =
    mode === 'listening' ? '#2a7a7a' :
    mode === 'thinking'  ? '#6b7280' :
    '#2a7a7a'

  const pulseColor =
    mode === 'listening' ? 'rgba(42,122,122,0.35)' :
    mode === 'speaking'  ? 'rgba(42,122,122,0.25)' :
    'rgba(107,114,128,0.2)'

  const barColor =
    mode === 'listening' ? '#2a7a7a' :
    mode === 'thinking'  ? '#9ca3af' :
    '#2a7a7a'

  const displayedSubtitle = mode === 'speaking' && subtitle
    ? subtitle + (cursorOn ? '▌' : ' ')
    : mode === 'thinking'
    ? ''
    : mode === 'listening' && micError
    ? micError
    : ''

  return (
    <>
      {/* ── Global styles ── */}
      <style>{`
        @keyframes vsm-pulse {
          0%   { transform: scale(1);    opacity: 0.9; }
          50%  { transform: scale(1.18); opacity: 0.4; }
          100% { transform: scale(1);    opacity: 0.9; }
        }
        @keyframes vsm-pulse-ring {
          0%   { transform: scale(1);    opacity: 0.6; }
          100% { transform: scale(1.7);  opacity: 0;   }
        }
        @keyframes vsm-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

      {/* ── Exit hint — top right ── */}
      <div style={{
        position: 'fixed', top: 20, right: 24,
        zIndex: 10010,
        fontSize: '0.72rem', color: 'var(--muted)',
        background: 'rgba(246,247,248,0.85)',
        backdropFilter: 'blur(8px)',
        padding: '4px 10px', borderRadius: 20,
        border: '1px solid var(--border)',
        animation: 'vsm-fade-in 0.3s ease',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        Ctrl+B or Esc to exit
      </div>

      {/* ── Gradient fade — only behind bottom area ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 220,
        background: 'linear-gradient(to bottom, transparent 0%, rgba(246,247,248,0.92) 55%, rgba(246,247,248,0.98) 100%)',
        zIndex: 10008,
        pointerEvents: 'none',
      }} />

      {/* ── Subtitle strip ── */}
      <div style={{
        position: 'fixed', bottom: 118, left: 0, right: 0,
        zIndex: 10009,
        textAlign: 'center',
        padding: '0 10vw',
        pointerEvents: 'none',
        minHeight: 36,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontSize: 'clamp(0.95rem, 2vw, 1.2rem)',
          fontWeight: 500,
          color: 'var(--text)',
          letterSpacing: '-0.01em',
          lineHeight: 1.5,
          animation: displayedSubtitle ? 'vsm-fade-in 0.15s ease' : 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {displayedSubtitle}
        </span>
      </div>

      {/* ── Bottom bar ── */}
      <div style={{
        position: 'fixed', bottom: 28, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10010,
        display: 'flex', alignItems: 'center', gap: 16,
        animation: 'vsm-fade-in 0.3s ease',
      }}>

        {/* Logo button with pulse ring */}
        <button
          onClick={() => {
            if (mode === 'listening') submitFnRef.current()
            else if (mode === 'speaking') exitMode()
          }}
          title={mode === 'listening' ? 'Tap to send' : mode === 'speaking' ? 'Stop speaking' : ''}
          aria-label={mode === 'listening' ? 'Submit voice input' : 'Stop speaking'}
          style={{
            position: 'relative',
            width: 52, height: 52,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #2c7873, #173f3b)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 2px 12px rgba(44,120,115,0.35)',
          }}
        >
          {/* Animated pulse ring */}
          <span style={{
            position: 'absolute', inset: -6,
            borderRadius: '50%',
            border: `2px solid ${pulseColor}`,
            animation: mode !== 'thinking'
              ? 'vsm-pulse-ring 1.4s ease-out infinite'
              : 'none',
            pointerEvents: 'none',
          }} />
          <SparkleIcon size={22} />
        </button>

        {/* Waveform bars */}
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: 3, height: 36,
        }}>
          {vaBars.map((level, i) => {
            const h = Math.max(4, Math.round((level / 255) * 32))
            return (
              <div key={i} style={{
                width: 3,
                height: h,
                borderRadius: 3,
                background: barColor,
                opacity: 0.7 + (level / 255) * 0.3,
                transition: 'height 0.07s ease-out',
              }} />
            )
          })}
        </div>

        {/* Status label */}
        <div style={{
          fontSize: '0.8rem',
          fontWeight: 600,
          color: mode === 'thinking' ? 'var(--muted)' : logoColor,
          letterSpacing: '0.03em',
          minWidth: 72,
          userSelect: 'none',
        }}>
          {statusLabel}
        </div>
      </div>
    </>
  )
}
