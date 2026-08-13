'use client'

import { useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js'
import type { ChartConfiguration } from 'chart.js'

Chart.register(...registerables)

export default function MiniChartInner({ config }: { config: ChartConfiguration }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  // JSON.stringify the config so the chart only rebuilds when data actually
  // changes, not every time a parent re-render produces a new object reference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const configKey = JSON.stringify(config)

  useEffect(() => {
    if (!ref.current) return
    if (chartRef.current) chartRef.current.destroy()
    chartRef.current = new Chart(ref.current, config)
    return () => { chartRef.current?.destroy() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey])

  return (
    <div className="chart-wrap">
      <canvas ref={ref} />
    </div>
  )
}
