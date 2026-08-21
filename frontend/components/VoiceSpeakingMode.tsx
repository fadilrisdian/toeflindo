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

  const [mode, setMode]           = useState<VSMode>('idle')
  const [subtitle, setSubtitle]   = useState('')
  const [cursorOn, setCursorOn]   = useState(true)
  const [vaBars, setVaBars]       = useState<number[]>(new Array(MIC_BARS).fill(0))
  const [chatbotOpen, setChatbotOpen] = useState(false)
  const [messages, setMessages]   = useState<Msg[]>([WELCOME_MSG])

  // ── Stable refs that survive async callbacks without stale closures ─────────
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

  // messagesRef always holds the latest messages so async callbacks never stale-close
  const messagesRef    = useRef<Msg[]>([WELCOME_MSG])
  const modeRef        = useRef<VSMode>('idle')
  // NOTE: modeRef is ONLY updated explicitly via modeRef.current = x alongside setMode()
  // Do NOT sync it from render — re-renders from setVaBars/animations would overwrite it

  useEffect(() => { messagesRef.current = messages }, [messages])

  // ── Chatbot sidebar tracking ───────────────────────────────────────────────
  useEffect(() => {
    const on  = () => setChatbotOpen(true)
    const off = () => setChatbotOpen(false)
    window.addEventListener('chatbot-open', on)
    window.addEventListener('chatbot-close', off)
    return () => { window.removeEventListener('chatbot-open', on); window.removeEventListener('chatbot-close', off) }
  }, [])

  // ── Blinking cursor ────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode === 'idle') return
    const id = setInterval(() => setCursorOn(v => !v), 530)
    return () => clearInterval(id)
  }, [mode])

  // ── Voice activity ─────────────────────────────────────────────────────────
  function stopVA() {
    if (vaRafRef.current) { cancelAnimationFrame(vaRafRef.current); vaRafRef.current = null }
    analyserRef.current = null
    setVaBars(new Array(MIC_BARS).fill(0))
  }

  function startVA(stream: MediaStream) {
    try {
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const an  = ctx.createAnalyser()
      an.fftSize = 64
      src.connect(an)
      analyserRef.current = an
      vaDataRef.current = new Uint8Array(an.frequencyBinCount) as Uint8Array<ArrayBuffer>
      const tick = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(vaDataRef.current!)
        const d = vaDataRef.current!
        const step = Math.floor(d.length / MIC_BARS)
        setVaBars(Array.from({ length: MIC_BARS }, (_, i) => d[i * step] ?? 0))
        vaRafRef.current = requestAnimationFrame(tick)
      }
      vaRafRef.current = requestAnimationFrame(tick)
    } catch { /* no AudioContext */ }
  }

  function startIdleAnim() {
    stopIdleAnim()
    const tick = () => {
      idlePhaseRef.current += 0.08
      const p = idlePhaseRef.current
      setVaBars(Array.from({ length: MIC_BARS }, (_, i) =>
        Math.round((Math.sin(p + i * 0.5) * 0.5 + 0.5) * 90 + 20)
      ))
      idleRafRef.current = requestAnimationFrame(tick)
    }
    idleRafRef.current = requestAnimationFrame(tick)
  }

  function stopIdleAnim() {
    if (idleRafRef.current) { cancelAnimationFrame(idleRafRef.current); idleRafRef.current = null }
  }

  // ── AudioContext ───────────────────────────────────────────────────────────
  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }

  // ── Stop everything ────────────────────────────────────────────────────────
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

  function stopMicStream() {
    stopVA()
    if (micRecorderRef.current?.state === 'recording') {
      try { micRecorderRef.current.stop() } catch { /* ok */ }
    }
    micRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    micStreamRef.current = null
    micChunksRef.current = []
  }

  // ── TTS per sentence — simple WAV, guaranteed to work ────────────────────
  async function speakSentenceVSM(
    sentence: string,
    onProgress: (partial: string) => void,
  ): Promise<void> {
    const abort = streamAbortRef.current
    const words = sentence.split(/\s+/).filter(Boolean)
    if (words.length === 0) { onProgress(sentence); return }

    try {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') await ctx.resume()

      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: sentence, voice: 'anna' }),
        signal: abort?.signal,
      })
      if (!res.ok) { onProgress(sentence); return }
      if (abort?.signal.aborted) return

      const arrayBuf = await res.arrayBuffer()
      if (abort?.signal.aborted) return

      const audioBuf = await ctx.decodeAudioData(arrayBuf)
      if (abort?.signal.aborted) return

      const now       = ctx.currentTime
      const startWhen = Math.max(now, ttsNextTimeRef.current)
      const node      = ctx.createBufferSource()
      node.buffer     = audioBuf
      node.connect(ctx.destination)
      node.start(startWhen)
      ttsNextTimeRef.current = startWhen + audioBuf.duration
      streamNodesRef.current.push(node)

      node.onended = () => {
        const nodes = streamNodesRef.current
        if (nodes.length > 0 && node === nodes[nodes.length - 1]) streamNodesRef.current = []
      }

      const totalMs = audioBuf.duration * 1000
      const delayMs = Math.max(0, (startWhen - now) * 1000)

      // Clear subtitle at sentence start
      wordTimersRef.current.push(setTimeout(() => {
        if (modeRef.current === 'speaking') setSubtitle('')
      }, delayMs))

      // Reveal word by word proportionally across the sentence duration
      words.forEach((_, i) => {
        const t       = delayMs + ((i + 1) / words.length) * totalMs
        const partial = words.slice(0, i + 1).join(' ')
        wordTimersRef.current.push(setTimeout(() => {
          if (modeRef.current === 'speaking') onProgress(partial)
        }, Math.max(0, t)))
      })

    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') onProgress(sentence)
    }
    // Returns after scheduling — not after playback
  }

  // ── processReply — LLM + TTS ───────────────────────────────────────────────
  async function processReply(transcript: string) {
    const userMsg: Msg = { role: 'user', content: transcript }
    const history = [
      ...messagesRef.current.filter(m => !(m.role === 'assistant' && m.content === WELCOME_MSG.content)),
      userMsg,
    ]
    setMessages(prev => [...prev, userMsg])

    const abort = new AbortController()
    streamAbortRef.current = abort

    // 1. LLM
    let reply = ''
    try {
      const res  = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: history, context: getPageContext(), tts_mode: true }),
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      reply = (data.reply || '').trim()
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      setMode('listening'); modeRef.current = 'listening'; startListening(); return
    }

    if (!reply) { setMode('listening'); modeRef.current = 'listening'; startListening(); return }

    setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    setMode('speaking')
    modeRef.current = 'speaking'
    stopIdleAnim()
    setSubtitle('')

    // Word-by-word reveal — rolling window of last 12 words (~2 lines)
    const words        = reply.split(/\s+/).filter(Boolean)
    const estimatedMs  = (words.length / 2.5) * 1000
    const MAX_WORDS    = 12

    words.forEach((_, i) => {
      const t       = ((i + 1) / words.length) * estimatedMs
      const start   = Math.max(0, i + 1 - MAX_WORDS)
      const partial = words.slice(start, i + 1).join(' ')
      wordTimersRef.current.push(setTimeout(() => {
        if (modeRef.current === 'speaking') setSubtitle(partial)
      }, Math.max(0, t)))
    })

    // TTS — use streaming endpoint (starts playing in ~300ms)
    const abort2 = new AbortController()
    streamAbortRef.current = abort2

    try {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') await ctx.resume()

      const res = await fetch('/api/chat/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: reply, voice: 'anna' }),
        signal: abort2.signal,
      })
      if (!res.ok || !res.body) {
        const waitMs = estimatedMs + 500
        wordTimersRef.current.push(setTimeout(() => {
          if (modeRef.current !== 'speaking') return
          setSubtitle(''); setMode('listening'); modeRef.current = 'listening'; startListening()
        }, waitMs))
        return
      }

      const reader = res.body.getReader()
      let buf = new Uint8Array(0)
      let sampleRate = 0
      let nextStart  = 0

      const appendBuf = (chunk: Uint8Array) => {
        const merged = new Uint8Array(buf.length + chunk.length)
        merged.set(buf); merged.set(chunk, buf.length)
        buf = merged
      }

      while (true) {
        const { done, value } = await reader.read()
        if (abort2.signal.aborted) break
        if (value) appendBuf(value)
        if (done && buf.length === 0) break

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

          const floatView = new Float32Array(buf.buffer, buf.byteOffset + offset + 4, nSamples)
          const floatCopy = new Float32Array(floatView)
          offset += 4 + byteLen

          const audioBuf = ctx.createBuffer(1, nSamples, sampleRate)
          audioBuf.copyToChannel(floatCopy, 0)
          const node = ctx.createBufferSource()
          node.buffer = audioBuf
          node.connect(ctx.destination)
          const now  = ctx.currentTime
          const when = Math.max(now, nextStart)
          nextStart  = when + audioBuf.duration
          node.start(when)
          streamNodesRef.current.push(node)

          node.onended = () => {
            const nodes = streamNodesRef.current
            if (nodes.length > 0 && node === nodes[nodes.length - 1]) {
              streamNodesRef.current = []
              if (modeRef.current !== 'speaking') return
              setSubtitle(''); setMode('listening'); modeRef.current = 'listening'; startListening()
            }
          }
        }

        if (offset > 0) buf = buf.slice(offset)
        if (done) break
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      const waitMs = estimatedMs + 500
      wordTimersRef.current.push(setTimeout(() => {
        if (modeRef.current !== 'speaking') return
        setSubtitle(''); setMode('listening'); modeRef.current = 'listening'; startListening()
      }, waitMs))
    }
  }

  // ── startListening ─────────────────────────────────────────────────────────
  async function startListening() {
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
      modeRef.current = 'listening'
    } catch {
      setMode('idle')
      modeRef.current = 'idle'
    }
  }

  // ── submitVoice — mirrors handleMicToggle in AIChatbot exactly ─────────────
  // Only job: unlock AudioContext, stop mic, create blob, transcribe,
  // then call processReply(transcript) — nothing else.
  async function submitVoice() {
    if (modeRef.current !== 'listening') return

    const mr = micRecorderRef.current
    if (!mr) return

    setMode('thinking')
    modeRef.current = 'thinking'
    stopVA()
    startIdleAnim()

    // Set onstop BEFORE calling stop — same as AIChatbot
    mr.onstop = async () => {
      const blob = new Blob(micChunksRef.current, { type: mr.mimeType || 'audio/webm' })
      // Clear mic state
      micRecorderRef.current = null
      micStreamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
      micStreamRef.current = null
      micChunksRef.current = []

      if (blob.size < 1) {
        setSubtitle('No audio captured — try again')
        modeRef.current = 'listening'; setMode('listening'); startListening(); return
      }

      // Transcribe
      const fd = new FormData()
      fd.append('audio', blob, 'vs_voice.webm')
      let transcript = ''
      try {
        const tr = await fetch('/api/chat/transcribe', { method: 'POST', body: fd, credentials: 'include' })
        const td = await tr.json()
        if (!tr.ok || td.error) { setMode('listening'); modeRef.current = 'listening'; startListening(); return }
        transcript = (td.text || '').trim()
      } catch {
        setMode('listening'); modeRef.current = 'listening'; startListening(); return
      }

      if (!transcript) { setMode('listening'); modeRef.current = 'listening'; startListening(); return }

      // Hand off to processReply — top-level function with clean state access
      await processReply(transcript)
    }

    if (mr.state === 'recording') mr.stop()
  }

  // ── exitMode ───────────────────────────────────────────────────────────────
  const exitMode = useCallback(() => {
    stopMicStream()
    stopTTS()
    setMode('idle')
    modeRef.current = 'idle'
    setSubtitle('')
    setVaBars(new Array(MIC_BARS).fill(0))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Global keyboard ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && modeRef.current !== 'idle') { e.preventDefault(); exitMode(); return }
      if (!((e.ctrlKey || e.metaKey) && e.key === 'b')) return
      if (chatbotOpen) return
      e.preventDefault()
      if (modeRef.current === 'idle') {
        // Ctrl+B — enter listening mode
        setMode('listening')
        modeRef.current = 'listening'
        startListening()
      } else if (modeRef.current === 'listening') {
        // Ctrl+B while listening — submit the recording
        try {
          if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContext()
          }
          if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume()
          }
        } catch { /* unavailable */ }
        submitVoice()
      } else if (modeRef.current === 'speaking') {
        // Ctrl+B while speaking — interrupt, stop audio, go back to listening
        stopTTS()
        setSubtitle('')
        setMode('listening')
        modeRef.current = 'listening'
        startListening()
      }
      // Ctrl+B while thinking — do nothing (wait for LLM to respond)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotOpen, exitMode])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopMicStream()
      stopTTS()
      audioCtxRef.current?.close().catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!user || pathname === '/login' || mode === 'idle') return null

  // ── Derived ────────────────────────────────────────────────────────────────
  const statusLabel  = mode === 'listening' ? 'Listening' : mode === 'thinking' ? 'Thinking…' : 'Speaking'
  const pulseColor   = mode === 'listening' ? 'rgba(42,122,122,0.4)' : mode === 'speaking' ? 'rgba(42,122,122,0.3)' : 'rgba(107,114,128,0.2)'
  const barColor     = mode === 'thinking' ? '#9ca3af' : '#2a7a7a'
  const displayedSub = mode === 'speaking' && subtitle
    ? subtitle + (cursorOn ? '▌' : '\u00a0')
    : ''

  return (
    <>
      <style>{`
        @keyframes vsm-pulse-ring {
          0%   { transform: scale(1);   opacity: 0.7; }
          100% { transform: scale(1.8); opacity: 0;   }
        }
        @keyframes vsm-fade-in {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

      {/* Exit hint */}
      <div style={{
        position: 'fixed', top: 20, right: 24, zIndex: 10010,
        fontSize: '0.72rem', color: 'var(--muted)',
        background: 'rgba(246,247,248,0.88)', backdropFilter: 'blur(8px)',
        padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)',
        animation: 'vsm-fade-in 0.3s ease', pointerEvents: 'none', userSelect: 'none',
      }}>
        Ctrl+B or Esc to exit
      </div>

      {/* Gradient fade */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: 220,
        background: 'linear-gradient(to bottom, transparent 0%, rgba(246,247,248,0.94) 55%, rgba(246,247,248,0.99) 100%)',
        zIndex: 10008, pointerEvents: 'none',
      }} />

      {/* Subtitle */}
      <div style={{
        position: 'fixed', bottom: 118, left: 0, right: 0, zIndex: 10009,
        textAlign: 'center', padding: '0 10vw', pointerEvents: 'none',
        minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontSize: 'clamp(0.95rem, 2vw, 1.15rem)', fontWeight: 500,
          color: 'var(--text)', letterSpacing: '-0.01em', lineHeight: 1.5,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {displayedSub}
        </span>
      </div>

      {/* Bottom bar */}
      <div style={{
        position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10010, display: 'flex', alignItems: 'center', gap: 16,
        animation: 'vsm-fade-in 0.3s ease',
      }}>
        <button
          onClick={() => {
            if (mode === 'speaking') { exitMode(); return }
            if (mode !== 'listening') return
            // Unlock AudioContext SYNCHRONOUSLY inside the click handler.
            // This must happen before any await — it's the only moment the
            // browser will honour it. submitVoice is fire-and-forget after this.
            try {
              if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
                audioCtxRef.current = new AudioContext()
              }
              if (audioCtxRef.current.state === 'suspended') {
                audioCtxRef.current.resume()   // intentionally no await
              }
            } catch { /* unavailable */ }
            submitVoice()
          }}
          title={mode === 'listening' ? 'Tap to send' : mode === 'speaking' ? 'Stop' : ''}
          aria-label={mode === 'listening' ? 'Submit voice input' : 'Stop speaking'}
          style={{
            position: 'relative', width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg, #2c7873, #173f3b)',
            border: 'none', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            boxShadow: '0 2px 12px rgba(44,120,115,0.35)',
          }}
        >
          <span style={{
            position: 'absolute', inset: -6, borderRadius: '50%',
            border: `2px solid ${pulseColor}`,
            animation: mode !== 'thinking' ? 'vsm-pulse-ring 1.4s ease-out infinite' : 'none',
            pointerEvents: 'none',
          }} />
          <SparkleIcon size={22} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 36 }}>
          {vaBars.map((level, i) => (
            <div key={i} style={{
              width: 3,
              height: Math.max(4, Math.round((level / 255) * 32)),
              borderRadius: 3, background: barColor,
              opacity: 0.65 + (level / 255) * 0.35,
              transition: 'height 0.07s ease-out',
            }} />
          ))}
        </div>

        <div style={{
          fontSize: '0.8rem', fontWeight: 600,
          color: mode === 'thinking' ? 'var(--muted)' : '#2a7a7a',
          letterSpacing: '0.03em', minWidth: 72, userSelect: 'none',
        }}>
          {statusLabel}
        </div>
      </div>
    </>
  )
}
