/**
 * Copia assets que o bundle nao embute para out/.
 *
 * Hoje:
 *  - o sensor PowerShell, lido em runtime por windows-sensor.ts;
 *  - o icone da bandeja (build/tray.png) usado pelo main.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const targetDir = join(root, 'out/main')
mkdirSync(targetDir, { recursive: true })

const assets = [
  [join(root, 'src/main/telemetry/sources/windows-sensor.ps1'), join(targetDir, 'windows-sensor.ps1')],
  [join(root, 'build/tray.png'), join(targetDir, 'tray.png')]
]

for (const [source, target] of assets) {
  if (!existsSync(source)) {
    console.error(`[copy-assets] nao encontrei ${source}`)
    process.exit(1)
  }
  copyFileSync(source, target)
  console.log(`[copy-assets] ${target}`)
}
