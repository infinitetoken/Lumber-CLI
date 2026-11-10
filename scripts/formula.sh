#!/usr/bin/env bash
# Points Formula/lumber.rb at the tarball npm serves as @infinitetoken/lumber-cli's latest, with its checksum
# (homebrew.yml runs it after each release)
set -euo pipefail

cd "$(dirname "$0")/.."
# Right after a release npm can still say the one before for a minute or so (the 0.4.0 run kept 0.3.0), so given the
# tag's version (homebrew.yml passes the Publish run's tag), it waits until npm says that
want="${LUMBER_VERSION:-}"
want="${want#v}"
for _ in $(seq 1 20); do
  version="$(npm view @infinitetoken/lumber-cli version)"
  if [[ -z "$want" || "$version" == "$want" ]]; then break; fi
  echo "npm still says ${version}, waiting for ${want}" >&2
  sleep 15
done
if [[ -z "$version" ]]; then echo "npm didn't say which version is latest" >&2; exit 1; fi
if [[ -n "$want" && "$version" != "$want" ]]; then echo "npm never said ${want}" >&2; exit 1; fi
url="https://registry.npmjs.org/@infinitetoken/lumber-cli/-/lumber-cli-${version}.tgz"
sha256="$(curl -fsSL "$url" | shasum -a 256 | cut -d ' ' -f 1)"
sed -i.bak -E "s|^  url \".*\"$|  url \"${url}\"|; s|^  sha256 \".*\"$|  sha256 \"${sha256}\"|" Formula/lumber.rb
rm Formula/lumber.rb.bak
echo "Formula/lumber.rb: lumber ${version} (${sha256})"
