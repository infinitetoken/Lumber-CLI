#!/usr/bin/env bash
# Points Formula/lumber.rb at the tarball npm serves as @infinitetoken/lumber-cli's latest, with its checksum
# (homebrew.yml runs it after each release)
set -euo pipefail

cd "$(dirname "$0")/.."
version="$(npm view @infinitetoken/lumber-cli version)"
if [[ -z "$version" ]]; then echo "npm didn't say which version is latest" >&2; exit 1; fi
url="https://registry.npmjs.org/@infinitetoken/lumber-cli/-/lumber-cli-${version}.tgz"
sha256="$(curl -fsSL "$url" | shasum -a 256 | cut -d ' ' -f 1)"
sed -i.bak -E "s|^  url \".*\"$|  url \"${url}\"|; s|^  sha256 \".*\"$|  sha256 \"${sha256}\"|" Formula/lumber.rb
rm Formula/lumber.rb.bak
echo "Formula/lumber.rb: lumber ${version} (${sha256})"
