// Checks a standalone lumber (scripts/sea.mjs) the way someone would first use it: its version, its help, and an MCP
// handshake, which loads everything the agents use. binaries.yml and scoop.yml run it on each system; the credential
// store is checked apart (LUMBER_STORE_CHECK), since Linux needs a Secret Service started for it.
//
//   node scripts/check-binary.mjs <path to lumber>
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'))
const binary = process.argv[2]
if (!binary) throw new Error('Usage: node scripts/check-binary.mjs <path to lumber>')
const env = { ...process.env, LUMBER_NO_UPDATE_CHECK: '1', NO_COLOR: '1' }

const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const said = spawnSync(binary, ['--version'], { encoding: 'utf8', env })
if (said.stdout?.trim() !== version) fail(`lumber --version said ${JSON.stringify(said.stdout?.trim())}, not ${version}: ${said.stderr ?? said.error}`)
process.stdout.write(`version: ${version}\n`)

// A developer's NODE_OPTIONS (a --require for their own project, say) is for their Node, not the one inside lumber
const withOptions = spawnSync(binary, ['--version'], { encoding: 'utf8', env: { ...env, NODE_OPTIONS: '--require ./no-such-hook.js' } })
if (withOptions.stdout?.trim() !== version) fail(`lumber --version with NODE_OPTIONS set failed: ${withOptions.stderr}`)
process.stdout.write('NODE_OPTIONS: ignored\n')

// An .exe starts straight from an agent, so the help never shows Windows' `cmd /c` (that's for npm's lumber.cmd)
const help = spawnSync(binary, ['help'], { encoding: 'utf8', env }).stdout ?? ''
if (!help.includes('claude mcp add lumber -- lumber mcp')) fail(`lumber help doesn't show claude mcp add lumber -- lumber mcp:\n${help}`)
process.stdout.write('help: claude mcp add lumber -- lumber mcp\n')

const server = spawn(binary, ['mcp'], { env, stdio: ['pipe', 'pipe', 'inherit'] })
const timer = setTimeout(() => {
  server.kill()
  fail('lumber mcp gave no answer to initialize in 20 seconds')
}, 20_000)
let out = ''
server.stdout.on('data', (chunk) => {
  out += chunk
  const line = out.split('\n').find((l) => l.includes('"id":1'))
  if (!line) return
  clearTimeout(timer)
  server.kill()
  const { result } = JSON.parse(line)
  if (result?.serverInfo?.name !== 'lumber' || result.serverInfo.version !== version) fail(`lumber mcp answered ${line}`)
  process.stdout.write(`mcp: ${result.serverInfo.name} ${result.serverInfo.version}, ${Object.keys(result.capabilities).join(', ')}\n`)
})
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-binary', version } } })}\n`)
