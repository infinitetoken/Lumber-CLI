// Overridable for running against a local API or socket
export const API_URL = process.env.LUMBER_API_URL ?? 'https://api.lumber.infinitetoken.com'
export const SOCKET_URL = process.env.LUMBER_SOCKET_URL ?? 'https://socket.lumber.infinitetoken.com'

// Set at build time from package.json (tsup.config.cjs)
export const VERSION = process.env.LUMBER_CLI_VERSION ?? '0.0.0'

// The app's Approve screen with a device link code filled in, as the phones share it (Lumber's linkCode.ts)
export const approveLinkUrl = (code: string): string => `lumber://account/approve-link?code=${encodeURIComponent(code)}`
