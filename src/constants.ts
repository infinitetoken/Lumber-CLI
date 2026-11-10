// Overridable for running against a local API or socket
export const API_URL = process.env.LUMBER_API_URL ?? 'https://api.lumber.infinitetoken.com'
export const SOCKET_URL = process.env.LUMBER_SOCKET_URL ?? 'https://socket.lumber.infinitetoken.com'

// Set at build time from package.json (tsup.config.cjs)
export const VERSION = process.env.LUMBER_CLI_VERSION ?? '0.0.0'

// Also set at build time: true in the standalone lumber, which carries its own Node (scripts/sea.mjs), and false in
// npm's, which runs on the Node it's installed under
export const STANDALONE = process.env.LUMBER_CLI_STANDALONE === '1'

// What the messages call the machine lumber runs on
export const THIS_COMPUTER = process.platform === 'darwin' ? 'this Mac' : 'this computer'
