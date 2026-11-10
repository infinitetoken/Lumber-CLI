// Writes the winget manifests for a release of the standalone lumber (InfiniteToken.LumberCLI, a portable lumber.exe
// inside each Windows zip), as microsoft/winget-pkgs lays them out, into build/winget. The first version goes to
// winget-pkgs by hand (a pull request with these three files); later ones are winget.yml's.
//
//   node scripts/winget.mjs [version] [--sums <file>] [--base-url <url>]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { REPO, releaseFromArgs } from './releases.mjs'

export const ID = 'InfiniteToken.LumberCLI'
const SCHEMA = '1.12.0'

const { version, file } = await releaseFromArgs()
const root = resolve(import.meta.dirname, '..')
const dir = join(root, 'build', 'winget', 'manifests', 'i', ...ID.split('.'), version)
mkdirSync(dir, { recursive: true })

const head = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${SCHEMA}.schema.json\n\nPackageIdentifier: ${ID}\nPackageVersion: ${version}\n`
const tail = (type) => `ManifestType: ${type}\nManifestVersion: ${SCHEMA}\n`
const installer = (architecture, target) => {
  const { url, sha256 } = file(target)
  return `- Architecture: ${architecture}\n  InstallerUrl: ${url}\n  InstallerSha256: ${sha256.toUpperCase()}\n`
}

const manifests = {
  [`${ID}.yaml`]: `${head('version')}DefaultLocale: en-US\n${tail('version')}`,
  [`${ID}.installer.yaml`]: `${head('installer')}InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
- RelativeFilePath: lumber.exe
  PortableCommandAlias: lumber
Commands:
- lumber
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
${installer('x64', 'windows-x64')}${installer('arm64', 'windows-arm64')}${tail('installer')}`,
  [`${ID}.locale.en-US.yaml`]: `${head('defaultLocale')}PackageLocale: en-US
Publisher: Infinite Token LLC
PublisherUrl: https://www.infinitetoken.com/
PublisherSupportUrl: https://github.com/${REPO}/issues
Author: Infinite Token LLC
PackageName: Lumber CLI
PackageUrl: https://lumber.infinitetoken.com/docs/cli
License: MIT
LicenseUrl: https://github.com/${REPO}/blob/main/LICENSE
Copyright: Copyright (c) 2026 Infinite Token LLC
ShortDescription: Read your Lumber logs from the terminal and from AI agents over MCP, decrypted on your computer.
Description: |-
  lumber reads your Lumber logs in the terminal (search, filter by level and time, tail as they arrive) and serves them to AI agents such as Claude Code over MCP.
  Lumber is end-to-end encrypted: logs are decrypted on your computer with your own account key, kept in Windows Credential Manager, so Lumber's servers can't read them.
  It only reads: it never changes anything in Lumber.
Moniker: lumber-cli
Tags:
- cli
- e2e-encryption
- logging
- logs
- mcp
- model-context-protocol
- ai-agents
- tail
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/v${version}
Documentations:
- DocumentLabel: Lumber CLI
  DocumentUrl: https://lumber.infinitetoken.com/docs/cli
${tail('defaultLocale')}`
}

for (const [name, text] of Object.entries(manifests)) writeFileSync(join(dir, name), text)
process.stdout.write(`${relative(root, dir)}: ${Object.keys(manifests).join(', ')}\n`)
