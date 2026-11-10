import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Node loads a native library only from a file, so the standalone lumber, which carries @napi-rs/keyring's inside
// itself (embeddedKeyring.ts), writes it to lumber's cache folder first. It's named by its hash and used again when
// the file there still holds exactly these bytes, so a run after the first writes nothing. Gives the file to load.
export const placeNativeLibrary = (bytes: Uint8Array, dir: string, name = 'keyring', pid = process.pid): string => {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const file = join(dir, `${name}-${hash}.node`)
  if (holds(file, bytes)) return file

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  // Written whole under a name of its own, then renamed into place, so another lumber starting at the same moment never
  // loads half a file
  const partial = join(dir, `${name}-${hash}.${pid}.partial`)
  writeFileSync(partial, bytes, { mode: 0o700 })
  let placed = file
  try {
    renameSync(partial, file)
  } catch {
    // Windows can't replace a library another lumber has loaded, which only comes up when the file there was damaged:
    // this run loads a copy of its own
    placed = join(dir, `${name}-${hash}-${pid}.node`)
    renameSync(partial, placed)
  }
  removeOthers(dir, name, hash)
  return placed
}

const holds = (file: string, bytes: Uint8Array): boolean => {
  try {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).equals(readFileSync(file))
  } catch {
    return false
  }
}

// Libraries an older lumber left. One still loaded (Windows) stays until a later run
const removeOthers = (dir: string, name: string, hash: string): void => {
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(`${name}-`) && entry.endsWith('.node') && !entry.startsWith(`${name}-${hash}`)) rmSync(join(dir, entry), { force: true })
    }
  } catch {
    // Tidying only
  }
}
