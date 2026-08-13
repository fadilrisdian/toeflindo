'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

function BasGuideContent() {
  const [html, setHtml] = useState('')
  const [err, setErr]   = useState('')

  useEffect(() => {
    fetch('/api/writing/guide/bas', {
      credentials: 'include',
    })
      .then(r => r.ok ? r.text() : Promise.reject(r.statusText))
      .then(setHtml)
      .catch((e: unknown) => setErr(String(e)))
  }, [])

  return (
    <>
      <Topbar />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6 text-xs text-[#6b7280]">
          <Link href="/practice/writing" className="hover:text-[#2a7a7a]">Writing</Link>
          <span>/</span>
          <Link href="/practice/writing/build-a-sentence" className="hover:text-[#2a7a7a]">Build a Sentence</Link>
          <span>/</span>
          <span className="font-medium text-[#1f2937]">Strategy Guide</span>
        </div>
        {err && <p className="text-red-500">{err}</p>}
        {html && <div dangerouslySetInnerHTML={{ __html: html }} />}
        {!html && !err && <p className="text-[#6b7280]">Loading guide…</p>}
      </main>
    </>
  )
}

export default function BasGuidePage() {
  return <RequireAuth><BasGuideContent /></RequireAuth>
}
