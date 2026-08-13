'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { AnnotatedSentence } from '@/components/CorrectionPopover'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

interface Mistake {
  id: number
  date: string
  category: string
  sub_type: string | null
  section: string | null
  task_type: string | null
  wrong: string
  correct: string
  recurrence_count: number
  reviewed: number
}

interface MistakesResp {
  rows: Mistake[]
  total: number
}

type Phase = 'prompt' | 'recording' | 'transcribing' | 'result'
function getSupportedMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
  for (const m of candidates) {
    if (!m || MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

function SpeakingMistakesPractice() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const taskTypeParam = searchParams.get('task_type') || ''
  const categoryParam = searchParams.get('category') || ''

  const [cards, setCards] = useState<Mistake[]>([])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('prompt')
  const [transcript, setTranscript] = useState('')
  const [sessionDone, setSD] = useState(false)
  const [loading, setLoading] = useState(true)
  const [recordingTime, setRecordingTime] = useState(0)

  // Recording refs
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchCards = useCallback(() => {
    setLoading(true)
    api.get<MistakesResp>('/api/grammar/mistakes', {
      page_size: 200, page: 1, section: 'Speaking',
      task_type: taskTypeParam, category: categoryParam,
    }).then(d => {
      setCards(d.rows.slice(0, 50))
      setIdx(0)
      setPhase('prompt')
      setSD(false)
    }).finally(() => setLoading(false))
  }, [taskTypeParam, categoryParam])

  useEffect(() => { fetchCards() }, [fetchCards])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const card = cards[idx]

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = getSupportedMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      mediaRecRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => handleRecordingDone()
      rec.start()
      setPhase('recording')
      setRecordingTime(0)
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch {
      alert('Microphone access denied. Please allow microphone to practice.')
    }
  }

  function stopRecording() {
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
      mediaRecRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function handleRecordingDone() {
    setPhase('transcribing')
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    const form = new FormData()
    form.append('audio', blob, 'speaking_mistake.webm')
    try {
      const res = await fetch('/api/speaking/transcribe', {
        method: 'POST', body: form, credentials: 'include',
      })
      const data = await res.json()
      setTranscript(data.text || data.transcript || '')
    } catch {
      setTranscript('[transcription failed]')
    }
    setPhase('result')
  }

  function skip() {
    setTranscript('')
    if (idx + 1 >= cards.length) { setSD(true) }
    else { setIdx(i => i + 1); setPhase('prompt') }
  }

  if (loading) return <><Topbar /><p className="p-6 text-[#6b7280]">Loading cards…</p></>

  if (!cards.length) return (
    <>
      <Topbar />
      <main className="max-w-xl mx-auto px-4 py-16 text-center">
        <p className="text-sm text-[#6b7280] mb-4">No speaking mistakes found.</p>
        <Link href="/practice" className="text-sm text-[#2a7a7a] underline">Back to Practice</Link>
      </main>
    </>
  )

  if (sessionDone) return (
    <>
      <Topbar />
      <main className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="text-4xl mb-4">🎉</div>
        <h1 className="text-xl font-bold text-[#1f2937] mb-2">Session complete!</h1>
        <p className="text-sm text-[#6b7280] mb-6">You practiced {cards.length} mistakes.</p>
        <button onClick={() => { router.push('/practice') }} className="btn-teal px-6">
          Back to Practice
        </button>
      </main>
    </>
  )

  if (!card) return null

  return (
    <>
      <Topbar />
      <main className="max-w-xl mx-auto px-4 py-8 space-y-5">
        {/* Breadcrumb + progress */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-[#6b7280]">
            <Link href="/practice" className="hover:text-[#2a7a7a]">Practice</Link>
            <span>/</span>
            <span className="text-[#1f2937] font-medium">Speaking Mistakes</span>
          </div>
          <span className="text-xs text-[#9ca3af]">{idx + 1} / {cards.length}</span>
        </div>

        {/* Card */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-[#eaf5f3] text-[#2a7a7a]">
              {card.category}
            </span>
            {card.task_type && (
              <span className="text-xs text-[#9ca3af]">{card.task_type}</span>
            )}
          </div>

          {/* Prompt: show wrong sentence */}
          <div>
            <p className="text-xs text-[#9ca3af] mb-1">Incorrect sentence</p>
            <p className="text-base text-[#1f2937] font-medium">{card.wrong}</p>
          </div>

          {phase === 'prompt' && (
            <div className="space-y-3">
              <p className="text-xs text-[#6b7280]">🎙️ Record yourself saying the <strong>correct</strong> version</p>
              <button onClick={startRecording}
                className="btn-teal w-full flex items-center justify-center gap-2">
                <span>🎤</span> Start Recording
              </button>
              <button onClick={skip}
                className="w-full text-center text-xs text-[#9ca3af] hover:text-[#6b7280] py-1 bg-transparent border-none cursor-pointer">
                Skip →
              </button>
            </div>
          )}

          {phase === 'recording' && (
            <div className="space-y-3 text-center">
              <div className="flex items-center justify-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-[#ef4444] animate-pulse" />
                <span className="text-sm font-medium text-[#1f2937]">Recording… {recordingTime}s</span>
              </div>
              <button onClick={stopRecording}
                className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-[#ef4444] hover:bg-[#dc2626] transition">
                ⏹ Stop Recording
              </button>
            </div>
          )}

          {phase === 'transcribing' && (
            <div className="text-center py-4">
              <p className="text-sm text-[#6b7280]">Transcribing…</p>
            </div>
          )}

          {phase === 'result' && (
            <div className="space-y-4">
              {/* Your transcript */}
              <div className="bg-[#f9fafb] rounded-lg px-4 py-3">
                <p className="text-xs text-[#6b7280] mb-0.5">What you said</p>
                <p className="text-sm text-[#1f2937]">{transcript || '(no speech detected)'}</p>
              </div>

              {/* Correct answer */}
              <div className="bg-[#eaf5f3] border border-[#c0dedd] rounded-lg px-4 py-3">
                <p className="text-xs text-[#2a7a7a] font-semibold mb-0.5">Correct version</p>
                <p className="text-sm text-[#1f2937]">{card.correct}</p>
              </div>

              {/* Diff view */}
              <div>
                <p className="text-xs text-[#9ca3af] mb-1">Comparison</p>
                <div className="text-sm">
                  <AnnotatedSentence wrong={card.wrong} correct={card.correct} />
                </div>
              </div>

              {/* Rating */}
              <button onClick={skip}
                className="w-full py-2 rounded-lg text-xs font-semibold text-white bg-[#2a7a7a]">
                Next →
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

export default function SpeakingMistakesPage() {
  return <RequireAuth><SpeakingMistakesPractice /></RequireAuth>
}
