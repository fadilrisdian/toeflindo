'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

function GuideContent({ slug }: { slug: string }) {
  const [html, setHtml] = useState('')
  const [err, setErr]   = useState('')

  useEffect(() => {
    const url = slug === 'email' ? '/api/writing/guide/email' : '/api/writing/guide/discussion'
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.text() : Promise.reject(r.statusText))
      .then(setHtml)
      .catch((e: unknown) => setErr(String(e)))
  }, [slug])

  return (
    <>
      <Topbar />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6 text-xs text-[#6b7280]">
          <Link href={`/practice/writing/${slug}`} className="hover:text-[#2a7a7a]">
            {slug === 'email' ? 'Write an Email' : 'Academic Discussion'}
          </Link>
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

export default function WritingGuidePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params)
  return <RequireAuth><GuideContent slug={type} /></RequireAuth>
}
