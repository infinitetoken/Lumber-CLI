import { join } from 'node:path'
import { getRawAsset } from 'node:sea'

import type * as Keyring from '@napi-rs/keyring'

import { placeNativeLibrary } from './nativeLibrary'
import { cacheDir } from './update'

// @napi-rs/keyring in the standalone lumber, which carries Node and all its code in one file (scripts/sea.mjs). The
// build puts this module where the package would be, so credentials.ts imports it the same way, and only on Windows
// and Linux. The package itself picks a native library from node_modules; here it's an asset of the executable,
// written out to lumber's cache folder and loaded from there.
export const KEYRING_ASSET = 'keyring.node'

const load = (): typeof Keyring => {
  const file = placeNativeLibrary(new Uint8Array(getRawAsset(KEYRING_ASSET)), join(cacheDir(), 'lumber-cli'))
  const addon = { exports: {} as typeof Keyring }
  process.dlopen(addon, file)
  return addon.exports
}

export const { AsyncEntry } = load()
