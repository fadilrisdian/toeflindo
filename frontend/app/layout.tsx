import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import AIChatbot from '@/components/AIChatbot'
import VoiceSpeakingMode from '@/components/VoiceSpeakingMode'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'toeflindo',
  description: 'TOEFL iBT practice and performance tracker',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          {children}
          <AIChatbot />
          <VoiceSpeakingMode />
        </AuthProvider>
      </body>
    </html>
  )
}
