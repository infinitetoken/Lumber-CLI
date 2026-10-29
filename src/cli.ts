import { runCommand } from './commands'

// Piped into `head`, stdout closes early; that's the reader being done, not an error
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

void runCommand(process.argv.slice(2)).then((code) => {
  // Success leaves the process to end on its own, since `lumber mcp` keeps serving after its command resolves
  if (code) process.exit(code)
})
