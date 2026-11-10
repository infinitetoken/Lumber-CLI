import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { placeNativeLibrary } from '../nativeLibrary'

const library = (text: string) => new Uint8Array(Buffer.from(text))

describe('placeNativeLibrary', () => {
  const folder = () => join(mkdtempSync(join(tmpdir(), 'lumber-native-')), 'lumber-cli')

  it('writes the library under its hash, and uses that file again on the next run', () => {
    const dir = folder()
    const file = placeNativeLibrary(library('v1'), dir)
    expect(file).toMatch(/keyring-[0-9a-f]{16}\.node$/)
    expect(readFileSync(file, 'utf8')).toBe('v1')

    const written = readFileSync(file)
    expect(placeNativeLibrary(library('v1'), dir)).toBe(file)
    expect(readFileSync(file).equals(written)).toBe(true)
    expect(readdirSync(dir)).toEqual([file.split(/[\\/]/).pop()])
  })

  it('writes a damaged file again before it is loaded', () => {
    const dir = folder()
    const file = placeNativeLibrary(library('v1'), dir)
    writeFileSync(file, 'tampered')
    expect(placeNativeLibrary(library('v1'), dir)).toBe(file)
    expect(readFileSync(file, 'utf8')).toBe('v1')
  })

  it('removes the libraries an older lumber left', () => {
    const dir = folder()
    const old = placeNativeLibrary(library('v1'), dir)
    const current = placeNativeLibrary(library('v2'), dir)
    expect(current).not.toBe(old)
    expect(existsSync(old)).toBe(false)
    expect(readdirSync(dir)).toEqual([current.split(/[\\/]/).pop()])
  })
})
