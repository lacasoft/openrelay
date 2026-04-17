#!/usr/bin/env bash
set -euo pipefail

VERSION=${1:?Usage: ./scripts/bump-version.sh <version>}

# Update root
node -e "const p=require('./package.json'); p.version='$VERSION'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2)+'\n')"

# Update all packages
for pkg in packages/*/package.json; do
  node -e "const p=require('./$pkg'); p.version='$VERSION'; require('fs').writeFileSync('$pkg', JSON.stringify(p, null, 2)+'\n')"
done

echo "Bumped all packages to v$VERSION"
