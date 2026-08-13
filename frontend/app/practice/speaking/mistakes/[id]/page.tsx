'use client'

import { use, useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

type Phase = 'prompt' | 'recording' | 'transcribing' | 'result'
function getSupportedMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
  for (const m of candidates) {
    if (!m || MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

function SpeakingMistakeDetail({ id }: { id: number }) {
  const router = useRouter()
  const [mistake, setMistake] = useState<Mistake | null>(null)
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<Phase>('prompt')
  const [transcript, setTranscript] = useState('')
  const [recordingTime, setRecordingTime] = useState(0)

  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api.get<Mistake>(`/api/grammar/mistakes/${id}`)
      .then(d => setMistake(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

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
      const res = await fetch('/api/grammar/transcribe', {
        method: 'POST', body: form, credentials: 'include',
      })
      const data = await res.json()
      setTranscript(data.text || data.transcript || '')
    } catch {
      setTranscript('[transcription failed]')
    }
    setPhase('result')
  }

  function tryAgain() {
    setPhase('prompt')
    setTranscript('')
  }

  if (loading) return <><Topbar /><p className="p-6 text-[#6b7280]">Loading…</p></>
  if (!mistake) return (
    <><Topbar /><main className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-sm text-[#6b7280]">Mistake not found.</p>
      <Link href="/practice/speaking/mistakes" className="text-sm text-[#2a7a7a] underline mt-4 inline-block">Back</Link>
    </main></>
  )

  return (
    <>
      <Topbar />
      <main className="max-w-xl mx-auto px-4 py-8 space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-[#6b7280]">
          <Link href="/practice/speaking/mistakes" className="hover:text-[#2a7a7a]">Speaking Mistakes</Link>
          <span>/</span>
          <span className="text-[#1f2937] font-medium">Practice</span>
        </div>

        {/* Card */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-[#eaf5f3] text-[#2a7a7a]">
              {mistake.category}
            </span>
            {mistake.sub_type && (
              <span className="text-xs text-[#6b7280] bg-[#f3f4f6] rounded px-1.5 py-0.5">{mistake.sub_type}</span>
            )}
            {mistake.task_type && (
              <span className="text-xs text-[#9ca3af]">{mistake.task_type}</span>
            )}
          </div>

          {/* Wrong sentence */}
          <div>
            <p className="text-xs text-[#9ca3af] mb-1">Incorrect sentence</p>
            <p className="text-base text-[#1f2937] font-medium">{mistake.wrong}</p>
          </div>

          {phase === 'prompt' && (
            <div className="space-y-3">
              <p className="text-xs text-[#6b7280]">🎙️ Record yourself saying the <strong>correct</strong> version</p>
              <button onClick={startRecording}
                className="btn-teal w-full flex items-center justify-center gap-2">
                <span>🎤</span> Start Recording
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
                <p className="text-sm text-[#1f2937]">{mistake.correct}</p>
              </div>

              {/* Diff view */}
              <div>
                <p className="text-xs text-[#9ca3af] mb-1">Comparison</p>
                <div className="text-sm">
                  <AnnotatedSentence wrong={mistake.wrong} correct={mistake.correct} />
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={tryAgain}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold border border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]">
                  🔄 Try Again
                </button>
                <button onClick={() => router.push('/practice/speaking/mistakes')}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold text-white bg-[#2a7a7a]">
                  ← Back to List
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

export default function SpeakingMistakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const parsedId = parseInt(id, 10)
  if (isNaN(parsedId)) {
    return <><RequireAuth><div style={{ padding: '2rem', color: '#dc2626' }}>Invalid mistake ID.</div></RequireAuth></>
  }
  return <RequireAuth><SpeakingMistakeDetail id={parsedId} /></RequireAuth>
}
