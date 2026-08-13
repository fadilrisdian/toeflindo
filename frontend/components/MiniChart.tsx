'use client'

import dynamic from 'next/dynamic'
import type { ChartConfiguration } from 'chart.js'

export interface MiniChartProps {
  config: ChartConfiguration
}

// chart.js accesses browser globals at module load time — must be SSR-disabled
const MiniChartInner = dynamic(() => import('./MiniChartInner'), { ssr: false })

export default function MiniChart({ config }: MiniChartProps) {
  return <MiniChartInner config={config} />
}
