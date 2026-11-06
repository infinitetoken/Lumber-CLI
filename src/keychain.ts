import { spawn } from 'node:child_process'

import { UsageError } from './errors'

// The session (token and account key) is one generic password in the login keychain, written and read through
// macOS's own `security` tool. An item it creates trusts `security` itself, so reading it back never prompts, even
// after Node is upgraded, which a native keychain module (trusting the node binary) would.
const SERVICE = 'Lumber CLI'
const ACCOUNT = 'session'
const NOT_FOUND = 44

// Said here, where a command first needs the Keychain, rather than as package.json's `os`, which npm also enforces on
// installing the project itself, so CI and the publish job (on Linux) couldn't build it
export const NOT_MACOS = 'lumber keeps your account key in the macOS Keychain, so it runs on macOS for now.'

const run = (args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      reject(new UsageError(NOT_MACOS))
      return
    }
    // Only `security -i` reads stdin. Piping it to the others raced them: one that had already exited closed the
    // pipe, and the write that ended it raised EPIPE with no handler, which crashed the command (seen on
    // `lumber apps`, 2026-11-06)
    const child = spawn('/usr/bin/security', args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    if (input !== undefined) {
      // An exit before it reads shows as a non-zero code and stderr, which the callers report
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(input)
    }
  })

export const readSecret = async (): Promise<string | null> => {
  const { code, stdout, stderr } = await run(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'])
  if (code === NOT_FOUND) return null
  if (code !== 0) throw new Error(`Couldn't read the Keychain: ${stderr.trim()}`)
  return Buffer.from(stdout.trim(), 'base64').toString('utf8')
}

// Written through `security -i`, which reads its command from stdin, so the secret never shows in the process list
// the way an argument would. Base64 keeps it free of the quotes and spaces that command line would have to escape.
export const writeSecret = async (value: string): Promise<void> => {
  const command = `add-generic-password -U -s "${SERVICE}" -a ${ACCOUNT} -l "${SERVICE}" -j "Session and account key for the lumber command" -w ${Buffer.from(value).toString('base64')}\n`
  const { code, stderr } = await run(['-i'], command)
  if (code !== 0 || stderr.trim()) throw new Error(`Couldn't save to the Keychain: ${stderr.trim()}`)
}

export const deleteSecret = async (): Promise<void> => {
  const { code, stderr } = await run(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT])
  if (code !== 0 && code !== NOT_FOUND) throw new Error(`Couldn't remove it from the Keychain: ${stderr.trim()}`)
}
