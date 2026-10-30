import type { ReactNode } from 'react'

export function Meter({
  value,
  tone = 'accent',
  height = 8
}: {
  value: number | null
  tone?: 'accent' | 'ok' | 'warn' | 'crit' | 'violet'
  height?: number
}): ReactNode {
  const pct = value == null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value))
  return (
    <div className="meter" style={{ height }}>
      <span className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Sparkline({
  values,
  width = 150,
  height = 38,
  color = '#22d3ee',
  max
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
  max?: number
}): ReactNode {
  if (values.length < 2) return <div className="spark spark-empty" style={{ width, height }} />
  const top = max ?? Math.max(1, ...values)
  const step = width / (values.length - 1)
  const points = values.map((value, index) => {
    const x = index * step
    const y = height - (Math.min(value, top) / top) * (height - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const area = `0,${height} ${points.join(' ')} ${width},${height}`
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function Pill({
  children,
  tone = 'neutral',
  title
}: {
  children: ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'crit' | 'accent' | 'violet'
  title?: string
}): ReactNode {
  return (
    <span className={`pill ${tone}`} title={title}>
      {children}
    </span>
  )
}

export function SectionTitle({
  children,
  hint
}: {
  children: ReactNode
  hint?: ReactNode
}): ReactNode {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {hint ? <span className="section-hint">{hint}</span> : null}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <div className="empty">{children}</div>
}
