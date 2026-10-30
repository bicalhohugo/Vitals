/**
 * Copia assets que o bundle nao embute para out/.
 *
 * Hoje: o sensor PowerShell. Ele e lido em runtime por
 * src/main/telemetry/sources/windows-sensor.ts.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const source = join(root, 'src/main/telemetry/sources/windows-sensor.ps1')
const targetDir = join(root, 'out/main')
const target = join(targetDir, 'windows-sensor.ps1')

if (!existsSync(source)) {
  console.error(`[copy-assets] nao encontrei ${source}`)
  process.exit(1)
}

mkdirSync(targetDir, { recursive: true })
copyFileSync(source, target)
console.log(`[copy-assets] ${target}`)
