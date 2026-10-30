/**
 * Doctor: diagnostico do ambiente. Nao altera nada e nao derruba processos.
 *
 *   npm run doctor
 *
 * Sai com codigo 1 quando um check obrigatorio falha. Rode antes de culpar o
 * codigo: 90% dos "nao aparece GPU" sao PATH sem nvidia-smi, PowerShell
 * bloqueado ou contadores de performance desabilitados.
 */
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadConfig, loadDotEnv } from '../src/main/config'
import { WindowsSensor } from '../src/main/telemetry/sources/windows-sensor'

const execFileAsync = promisify(execFile)

interface Check {
  name: string
  required: boolean
  ok: boolean
  detail: string
}

const checks: Check[] = []

function record(name: string, required: boolean, ok: boolean, detail: string): void {
  checks.push({ name, required, ok, detail })
  const mark = ok ? 'OK  ' : required ? 'FAIL' : 'WARN'
  console.log(`  [${mark}] ${name}${detail ? ` - ${detail}` : ''}`)
}

async function run(): Promise<void> {
  loadDotEnv()
  const config = loadConfig()

  console.log('\nVitals doctor\n-------------\n')

  record(
    'Windows',
    true,
    process.platform === 'win32',
    process.platform === 'win32' ? `${process.arch}` : `plataforma ${process.platform}`
  )

  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  record('Node >= 22', true, major >= 22, process.versions.node)

  if (process.platform === 'win32') {
    await checkNvidia()
    await checkPowerShell()
    await checkCounters()
    await checkElevation()
  }

  checkLogDir(config.logDir)
  await checkPort(config.http.port)

  if (process.platform === 'win32') {
    await checkSensor(config.sampleIntervalMs)
  }

  const failed = checks.filter((check) => check.required && !check.ok)
  const warned = checks.filter((check) => !check.required && !check.ok)

  console.log('')
  if (failed.length > 0) {
    console.log(`${failed.length} check(s) obrigatorio(s) falharam.`)
    process.exitCode = 1
  } else {
    console.log(`ambiente ok${warned.length ? ` (${warned.length} aviso(s))` : ''}.`)
  }
  console.log(`logs: ${config.logDir}\n`)
}

async function checkNvidia(): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,temperature.gpu', '--format=csv,noheader'],
      { timeout: 5000, windowsHide: true }
    )
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
    record('nvidia-smi', false, lines.length > 0, lines.join(' | ') || 'sem saida')
  } catch (error) {
    record('nvidia-smi', false, false, error instanceof Error ? error.message.slice(0, 120) : 'falhou')
  }
}

async function checkPowerShell(): Promise<void> {
  for (const candidate of ['pwsh', 'powershell']) {
    try {
      const { stdout } = await execFileAsync(
        candidate,
        ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
        { timeout: 8000, windowsHide: true }
      )
      record(`PowerShell (${candidate})`, true, true, stdout.trim())
      return
    } catch {
      // tenta o proximo
    }
  }
  record('PowerShell', true, false, 'pwsh/powershell nao encontrados ou bloqueados')
}

async function checkCounters(): Promise<void> {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$names=@('GPU Engine','GPU Process Memory','GPU Adapter Memory','Memory')",
    '$missing=@()',
    'foreach($n in $names){ if(-not [System.Diagnostics.PerformanceCounterCategory]::Exists($n)){ $missing+=$n } }',
    'if($missing.Count -gt 0){ Write-Output ("faltando: "+($missing -join ", ")); exit 2 }',
    'Write-Output ("ok: "+($names -join ", "))'
  ].join('; ')

  try {
    const { stdout } = await execFileAsync(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 20_000, windowsHide: true }
    )
    const text = stdout.trim()
    record('contadores de performance', true, !text.startsWith('faltando'), text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    record('contadores de performance', true, false, message.slice(0, 160))
  }
}

async function checkElevation(): Promise<void> {
  try {
    await execFileAsync('net', ['session'], { timeout: 4000, windowsHide: true })
    record('elevacao', false, true, 'rodando como admin (pode encerrar processos de outros usuarios)')
  } catch {
    record('elevacao', false, false, 'sem admin: processos de outros usuarios exigirao elevacao')
  }
}

function checkLogDir(logDir: string): void {
  try {
    mkdirSync(logDir, { recursive: true })
    const file = join(logDir, '.doctor.tmp')
    writeFileSync(file, 'ok', 'utf8')
    unlinkSync(file)
    record('diretorio de logs', true, true, logDir)
  } catch (error) {
    record(
      'diretorio de logs',
      true,
      false,
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function checkPort(port: number): Promise<void> {
  const free = await new Promise<boolean>((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
  record(`porta HTTP ${port}`, false, free, free ? 'livre' : 'em uso (outra instancia?)')
}

async function checkSensor(intervalMs: number): Promise<void> {
  const sensor = new WindowsSensor(intervalMs)
  const started = Date.now()
  try {
    await sensor.start()
    const meta = sensor.getMeta()
    const tick = sensor.getLatest()
    record(
      'sensor Windows',
      true,
      tick != null,
      tick
        ? `${meta.adapters.length} adaptador(es), ${tick.procs.length} processos, amostra ${tick.sampleMs}ms (${Date.now() - started}ms para subir)`
        : 'sem amostra'
    )
    for (const adapter of meta.adapters) {
      console.log(
        `         - ${adapter.name} [${adapter.luid}] ${adapter.vendor}/${adapter.kind} vram=${(
          adapter.dedicatedBytes / 1024 ** 3
        ).toFixed(1)}GB`
      )
    }
    if (tick && tick.errors.length > 0) {
      console.log(`         erros: ${tick.errors.slice(0, 3).join(' | ')}`)
    }
  } catch (error) {
    record('sensor Windows', true, false, error instanceof Error ? error.message : String(error))
  } finally {
    sensor.stop()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
