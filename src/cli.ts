import { runCommand } from './commands'
import { checkStore, storeName } from './credentials'

// Piped into `head`, stdout closes early; that's the reader being done, not an error
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

// CI runs each standalone binary with LUMBER_STORE_CHECK set (binaries.yml), to see that it reaches the system's
// credential store: it saves, reads and removes a test item, never the session, and does nothing else
if (process.env.LUMBER_STORE_CHECK) {
  checkStore().then(
    () => void process.stdout.write(`Saved, read and removed a test item in ${storeName()}\n`),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  )
} else {
  void runCommand(process.argv.slice(2)).then((code) => {
    // Success leaves the process to end on its own, since `lumber mcp` keeps serving after its command resolves
    if (code) process.exit(code)
  })
}
