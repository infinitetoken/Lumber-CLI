// Builds the standalone lumber: Node and the whole CLI in one executable (Node's single executable applications), for
// winget, Scoop and the GitHub release, where people expect a program rather than an npm package on a Node of their
// own. binaries.yml runs it on each system's own runner.
//
//   node scripts/sea.mjs                                  this computer's system, with the Node running the script
//   node scripts/sea.mjs --node <path>                    with another Node 26 for this system (nodejs.org's)
//   node scripts/sea.mjs --target windows-x64 --node <node.exe>   another system's, with that system's Node
//   node scripts/sea.mjs build|pack [--target ...]        one half: CI checks (and on Windows will sign) the executable
//                                                         in build/sea/<target> between the two
//
// The Node has to be a whole one, as nodejs.org and setup-node give: Homebrew's is a small launcher for its libnode.
// On Windows and Linux, lumber keeps its session through @napi-rs/keyring, whose native library rides inside the
// executable as an asset (embeddedKeyring.ts writes it out and loads it). Writes release/lumber-<version>-<target>.zip
// (Windows) or .tar.gz, holding lumber, its LICENSE and THIRD-PARTY-NOTICES.txt, the licenses of Node and of every
// package built into it.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { build } from 'tsup'

const root = resolve(import.meta.dirname, '..')
// esbuild names the files it bundled relative to here, and tsup takes the entry from here
process.chdir(root)
const require = createRequire(join(root, 'package.json'))
const { version } = require('./package.json')

// What each target is called here, and the @napi-rs/keyring package carrying its native library (none on macOS, where
// lumber keeps the session through /usr/bin/security)
const TARGETS = {
  'windows-x64': { platform: 'win32', arch: 'x64', keyring: 'win32-x64-msvc' },
  'windows-arm64': { platform: 'win32', arch: 'arm64', keyring: 'win32-arm64-msvc' },
  'linux-x64': { platform: 'linux', arch: 'x64', keyring: 'linux-x64-gnu' },
  'linux-arm64': { platform: 'linux', arch: 'arm64', keyring: 'linux-arm64-gnu' },
  'macos-arm64': { platform: 'darwin', arch: 'arm64' },
  'macos-x64': { platform: 'darwin', arch: 'x64' }
}

const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}`)
  return result
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { target: { type: 'string' }, node: { type: 'string' } } })
const step = positionals[0] ?? 'all'
if (!['build', 'pack', 'all'].includes(step)) fail(`${step}? It's build, pack, or both when left out`)
const host = Object.keys(TARGETS).find((name) => TARGETS[name].platform === process.platform && TARGETS[name].arch === process.arch)
const targetName = values.target ?? host
const target = TARGETS[targetName]
if (!target) fail(`No standalone lumber for ${targetName ?? `${process.platform} ${process.arch}`}: it builds for ${Object.keys(TARGETS).join(', ')}`)
const exe = target.platform === 'win32' ? 'lumber.exe' : 'lumber'
const work = join(root, 'build', 'sea', targetName)
const output = join(work, exe)

const buildExecutable = async () => {
  const native = targetName === host
  const node = resolve(values.node ?? process.execPath)
  if (!native && !values.node) fail(`Building for ${targetName} on ${host} needs --node, that system's Node ${process.version} (nodejs.org's)`)
  if (!existsSync(node)) fail(`No Node at ${node}`)
  // Homebrew's node is a launcher of about 100 KB that loads its libnode, so an executable made from it needs Homebrew
  if (statSync(node).size < 20_000_000) fail(`${node} isn't a whole Node (Homebrew's loads its libnode): use nodejs.org's, with --node`)
  // Another system's Node can't run here to say, and has to be this one's version anyway (the blob and the binary match)
  const nodeVersion = native ? spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout.trim() : process.version
  if (Number(nodeVersion.slice(1).split('.')[0]) < 26) fail(`${node} is Node ${nodeVersion}: the standalone lumber is built with Node 26`)

  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  // 1. The CLI and every package it uses in one ES module. Node's built-ins stay imports; anything else would have to be
  // on disk, which a standalone executable can't count on. @napi-rs/keyring becomes embeddedKeyring.ts, and the require()
  // some bundled CommonJS packages make for built-ins gets one of its own
  await build({
    config: false,
    silent: true,
    entry: { cli: 'src/cli.ts' },
    outDir: work,
    format: ['esm'],
    platform: 'node',
    target: 'node26',
    splitting: false,
    noExternal: [/.*/],
    // node:sea is a built-in only by that name
    removeNodeProtocol: false,
    metafile: true,
    define: { 'process.env.LUMBER_CLI_VERSION': JSON.stringify(version), 'process.env.LUMBER_CLI_STANDALONE': JSON.stringify('1') },
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    esbuildOptions: (options) => {
      options.alias = { '@napi-rs/keyring': join(root, 'src', 'embeddedKeyring.ts') }
    }
  })
  const bundle = join(work, 'cli.mjs')
  if (!existsSync(bundle)) fail('tsup wrote no bundle')

  // 2. The native library, from node_modules when npm installed it for this system, or from npm when building for another
  const keyringPackage = (() => {
    if (!target.keyring) return null
    const name = `@napi-rs/keyring-${target.keyring}`
    const wanted = require('@napi-rs/keyring/package.json').version
    try {
      const dir = dirname(require.resolve(`${name}/package.json`))
      if (require(`${name}/package.json`).version === wanted) return dir
    } catch {
      // Not installed: npm installs only this system's
    }
    const into = mkdtempSync(join(tmpdir(), 'lumber-keyring-'))
    const packed = run('npm', ['pack', `${name}@${wanted}`, '--pack-destination', into, '--silent'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: process.platform === 'win32' })
    run('tar', ['-xzf', join(into, packed.stdout.trim().split('\n').pop()), '-C', into])
    return join(into, 'package')
  })()
  const keyringLibrary = keyringPackage && join(keyringPackage, `keyring.${target.keyring}.node`)
  if (keyringLibrary && !existsSync(keyringLibrary)) fail(`No ${basename(keyringLibrary)} in ${keyringPackage}`)

  // 3. The executable. Built by the target's own Node when it can run here, which also compiles the code cache it starts
  // from; another system's can't run here, so this Node builds it, without one (a code cache only loads where it was made)
  const config = join(work, 'sea-config.json')
  writeFileSync(
    config,
    JSON.stringify(
      {
        main: bundle,
        mainFormat: 'module',
        executable: node,
        output,
        disableExperimentalSEAWarning: true,
        // Node reads NODE_OPTIONS by default, and a developer's (a --require for their own project, say) would break lumber
        execArgvExtension: 'none',
        useCodeCache: native,
        assets: keyringLibrary ? { 'keyring.node': keyringLibrary } : {}
      },
      null,
      2
    )
  )
  run(native ? node : process.execPath, ['--build-sea', config])

  // macOS runs nothing unsigned on Apple silicon: signed ad hoc, as Node's own instructions do
  if (target.platform === 'darwin') {
    if (process.platform !== 'darwin') fail('A macOS lumber is signed with codesign, so it builds on a Mac')
    run('codesign', ['--sign', '-', '--force', output])
  }

  if (native) {
    const said = spawnSync(output, ['--version'], { encoding: 'utf8', env: { ...process.env, LUMBER_NO_UPDATE_CHECK: '1' } })
    if (said.stdout?.trim() !== version) fail(`The built lumber says ${JSON.stringify(said.stdout?.trim())}, not ${version}${said.stderr ? `: ${said.stderr.trim()}` : ''}`)
  }

  // 4. The licenses that come with it: Node's (beside its binary, in nodejs.org's archives and setup-node's), and each
  // package esbuild put in the bundle, with the native library's own crates
  const nodeLicense = [join(dirname(node), 'LICENSE'), join(dirname(node), '..', 'LICENSE')].find(existsSync)
  if (!nodeLicense) fail(`No LICENSE beside ${node}: the standalone lumber carries Node, so it ships Node's license`)

  const packageRoots = new Set()
  const metafile = JSON.parse(
    readFileSync(
      readdirSync(work)
        .filter((f) => f.startsWith('metafile'))
        .map((f) => join(work, f))[0],
      'utf8'
    )
  )
  for (const input of Object.keys(metafile.inputs)) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)
    if (match) packageRoots.add(resolve(root, match[1]))
  }
  const licenseText = (dir) => {
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
    return file ? readFileSync(join(dir, file), 'utf8').trim() : null
  }
  const sections = [`Node.js ${nodeVersion}\n\n${readFileSync(nodeLicense, 'utf8').trim()}`]
  for (const dir of [...packageRoots].sort()) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const text = licenseText(dir)
    if (!text) fail(`${pkg.name} has no license file to ship (its package.json says ${pkg.license ?? 'nothing'})`)
    sections.push(`${pkg.name} ${pkg.version} (${pkg.license ?? pkg.licenses?.map((l) => l.type).join(', ')})\n\n${text}`)
  }
  if (keyringPackage) {
    const pkg = require('@napi-rs/keyring/package.json')
    sections.push(`${pkg.name} ${pkg.version} (${pkg.license})\n\n${licenseText(dirname(require.resolve('@napi-rs/keyring/package.json')))}`)
    const crates = join(keyringPackage, 'LICENSE.third-party.md')
    if (existsSync(crates)) sections.push(`The Rust crates in ${basename(keyringLibrary)}\n\n${readFileSync(crates, 'utf8').trim()}`)
  }
  const rule = `\n\n${'-'.repeat(80)}\n\n`
  writeFileSync(join(work, 'THIRD-PARTY-NOTICES.txt'), `lumber ${version} is built with Node.js and these packages, under their own licenses.${rule}${sections.join(rule)}\n`)
  copyFileSync(join(root, 'LICENSE'), join(work, 'LICENSE'))
}

// 5. The archive, its files at the top: a zip for Windows, which winget and Scoop unpack, and a tarball elsewhere
const pack = () => {
  const files = [exe, 'LICENSE', 'THIRD-PARTY-NOTICES.txt']
  for (const file of files) if (!existsSync(join(work, file))) fail(`No ${file} in ${relative(root, work)}: build it first`)
  const release = join(root, 'release')
  mkdirSync(release, { recursive: true })
  const archive = join(release, `lumber-${version}-${targetName}.${target.platform === 'win32' ? 'zip' : 'tar.gz'}`)
  rmSync(archive, { force: true })
  // On a Mac, without the extended attributes and ._ files macOS's tar adds, which other systems unpack as clutter
  const plain = process.platform === 'darwin' ? ['--no-xattrs', '--no-mac-metadata'] : []
  const tarEnv = { env: { ...process.env, COPYFILE_DISABLE: '1' } }
  // Windows' own tar is bsdtar, which writes a zip when the name says so; Git Bash puts its GNU tar, which can't, first
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  if (archive.endsWith('.tar.gz')) run(tar, [...plain, '-czf', archive, '-C', work, ...files], tarEnv)
  else if (process.platform === 'linux') run('zip', ['-q', '-j', archive, ...files.map((f) => join(work, f))])
  else run(tar, [...plain, '-a', '-cf', archive, '-C', work, ...files], tarEnv)

  const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex')
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
  process.stdout.write(`${relative(root, archive)}: ${mb(statSync(archive).size)} (lumber ${mb(statSync(output).size)}), sha256 ${sha256}\n`)
}

if (step !== 'pack') await buildExecutable()
if (step !== 'build') pack()
