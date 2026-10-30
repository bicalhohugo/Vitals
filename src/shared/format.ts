/** Formatadores compartilhados por main, renderer e scripts. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes)) return '--'
  if (bytes <= 0) return '0 B'
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exp
  const decimals = exp === 0 ? 0 : value >= 100 ? 0 : digits
  return `${value.toFixed(decimals)} ${UNITS[exp]}`
}

export function formatMiB(mib: number | null | undefined, digits = 1): string {
  if (mib == null || !Number.isFinite(mib)) return '--'
  if (mib >= 1024) return `${(mib / 1024).toFixed(digits)} GB`
  return `${mib.toFixed(0)} MB`
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value.toFixed(digits)}%`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--'
  const s = Math.floor(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function formatClock(ts: number | null | undefined): string {
  if (!ts) return '--:--:--'
  return new Date(ts).toLocaleTimeString('pt-BR', { hour12: false })
}

export function formatWatts(w: number | null | undefined): string {
  if (w == null || !Number.isFinite(w)) return '--'
  return `${w.toFixed(0)} W`
}

export function formatTemp(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return '--'
  return `${c.toFixed(0)} °C`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function ratio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0
  return clamp(value / total, 0, 1)
}
