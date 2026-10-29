// The tests read the CLI's output as plain text. Jest sometimes runs them in its own process rather than in workers
// (when it expects that to be quicker), and run from a terminal, stdout is then that terminal: termkit's spinners
// draw and its colors switch on, and the output carries escape codes. In workers, and in CI, it never is a terminal.
for (const stream of [process.stdout, process.stderr]) Object.defineProperty(stream, 'isTTY', { value: false, configurable: true })
