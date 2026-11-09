// Overridable for running against a local API or socket
export const API_URL = process.env.LUMBER_API_URL ?? 'https://api.lumber.infinitetoken.com'
export const SOCKET_URL = process.env.LUMBER_SOCKET_URL ?? 'https://socket.lumber.infinitetoken.com'

// Set at build time from package.json (tsup.config.cjs)
export const VERSION = process.env.LUMBER_CLI_VERSION ?? '0.0.0'

// What the messages call the machine lumber runs on
export const THIS_COMPUTER = process.platform === 'darwin' ? 'this Mac' : 'this computer'
