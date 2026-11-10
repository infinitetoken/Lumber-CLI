// What scoop.mjs and winget.mjs need to know about a GitHub release of the standalone lumber: its version, where its
// files are, and their sha256s, from the SHA256SUMS binaries.yml attaches to it
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

export const REPO = 'infinitetoken/Lumber-CLI'

const get = async (url) => {
  const response = await fetch(url, { headers: { 'User-Agent': 'lumber-cli-release-scripts' } })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
  return response
}

// [version] [--sums <file>] [--base-url <url>]: the version defaults to the latest release, the files to its downloads;
// a local SHA256SUMS and base URL point at files that aren't released, to try them out
export const releaseFromArgs = async () => {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { sums: { type: 'string' }, 'base-url': { type: 'string' } } })
  const version = (positionals[0] ?? (await (await get(`https://api.github.com/repos/${REPO}/releases/latest`)).json()).tag_name).replace(/^v/, '')
  const base = (values['base-url'] ?? `https://github.com/${REPO}/releases/download/v${version}`).replace(/\/$/, '')
  const sums = values.sums ? readFileSync(values.sums, 'utf8') : await (await get(`${base}/SHA256SUMS`)).text()
  const hashes = new Map(
    sums
      .split('\n')
      .map((line) => /^([0-9a-f]{64}) [ *]?(\S+)$/i.exec(line.trim()))
      .filter(Boolean)
      .map(([, hash, file]) => [file, hash.toLowerCase()])
  )
  const file = (target) => {
    const name = `lumber-${version}-${target}.${target.startsWith('windows') ? 'zip' : 'tar.gz'}`
    const sha256 = hashes.get(name)
    if (!sha256) throw new Error(`SHA256SUMS has no ${name}`)
    return { name, url: `${base}/${name}`, sha256 }
  }
  return { version, base, file }
}
