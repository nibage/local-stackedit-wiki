#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
get() {
  url="$1"; dest="$2"; min="$3"
  tmp="$dest.download"
  trap 'rm -f "$tmp"' EXIT HUP INT TERM
  curl --fail --location --silent --show-error "$url" -o "$tmp"
  count=$(wc -c < "$tmp")
  if [ "$count" -lt "$min" ]; then echo "Unexpectedly short download: $url" >&2; exit 1; fi
  mv "$tmp" "$dest"
  trap - EXIT HUP INT TERM
  printf 'OK: %s\n' "$dest"
}
get 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/8.9.2/mermaid.min.js' "$root/vendor/mermaid/mermaid.min.js" 100000
get 'https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.4.4/abcjs-basic-min.min.js' "$root/vendor/abcjs/abcjs-basic-min.js" 50000
printf 'Done. The browser now runs the renderers offline.\n'
