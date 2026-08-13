'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import RequireAuth from '@/components/RequireAuth'
import Topbar from '@/components/Topbar'

const CARDS = [
  { href: '/practice',  title: 'Practice',             desc: 'TOEFL iBT writing & speaking practice with AI scoring' },
  { href: '/dashboard', title: 'Performance Dashboard', desc: 'Charts & stats — scores, mistakes, grammar accuracy' },
]

function HomeContent() {
  const { user } = useAuth()
  return (
    <>
      <Topbar />
      <main className="max-w-md mx-auto px-4 py-12">
        <div className="card p-8 shadow-lg">
          <h1 className="text-lg font-bold text-[#1f2937] mb-1">Welcome back, {user}</h1>
          <p className="text-xs text-[#6b7280] mb-6">Where would you like to go?</p>
          <div className="flex flex-col gap-3">
            {CARDS.map(c => (
              <Link key={c.href} href={c.href}
                className="block bg-[#f6f7f8] border border-[#e6e8eb] rounded-xl px-4 py-3.5
                           hover:border-[#2a7a7a] hover:bg-[#eaf5f3] transition-all">
                <div className="font-bold text-sm text-[#1f2937]">{c.title}</div>
                <div className="text-xs text-[#6b7280] mt-0.5">{c.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}

export default function HomePage() {
  return <RequireAuth><HomeContent /></RequireAuth>
}
