// Writes bucket/lumber.json: this repo is also a Scoop bucket, as it's the Homebrew tap. It points at a release's
// Windows zips, with their sha256s from its SHA256SUMS. scoop.yml runs it after each release, installs what it wrote
// with Scoop and commits it.
//
//   node scripts/scoop.mjs [version] [--sums <file>] [--base-url <url>]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { REPO, releaseFromArgs } from './releases.mjs'

const { version, file } = await releaseFromArgs()
const x64 = file('windows-x64')
const arm64 = file('windows-arm64')
const download = `https://github.com/${REPO}/releases/download/v$version`

const manifest = {
  version,
  description: 'Read your Lumber logs from the terminal and from AI agents over MCP, decrypted on your computer',
  homepage: 'https://lumber.infinitetoken.com/docs/cli',
  license: 'MIT',
  notes: 'Sign in and link this computer with: lumber login',
  architecture: {
    '64bit': { url: x64.url, hash: x64.sha256 },
    arm64: { url: arm64.url, hash: arm64.sha256 }
  },
  bin: 'lumber.exe',
  checkver: { github: `https://github.com/${REPO}` },
  autoupdate: {
    architecture: {
      '64bit': { url: `${download}/lumber-$version-windows-x64.zip` },
      arm64: { url: `${download}/lumber-$version-windows-arm64.zip` }
    },
    hash: { url: '$baseurl/SHA256SUMS' }
  }
}

const bucket = resolve(import.meta.dirname, '..', 'bucket')
mkdirSync(bucket, { recursive: true })
writeFileSync(join(bucket, 'lumber.json'), `${JSON.stringify(manifest, null, 4)}\n`)
process.stdout.write(`bucket/lumber.json: lumber ${version}\n`)
