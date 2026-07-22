#!/usr/bin/env bash
set -euo pipefail

# Ensure we are on master with a clean working tree
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "master" ]; then
  echo "Error: must be on master branch (current: $CURRENT_BRANCH)" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash changes before releasing." >&2
  git status --porcelain
  exit 1
fi

echo
echo "Current version: $(node -p "require('./package.json').version")"
echo
echo "Select version bump type:"
echo "1) patch (bug fixes)"
echo "2) minor (new features)"
echo "3) major (breaking changes)"
echo

read -p "Enter your choice (1-3): " choice

case $choice in
  1) RELEASE_TYPE="patch" ;;
  2) RELEASE_TYPE="minor" ;;
  3) RELEASE_TYPE="major" ;;
  *) echo "❌ Invalid choice. Exiting."; exit 1 ;;
esac

# Bump package.json without tagging, then read back the resolved version
pnpm version "$RELEASE_TYPE" --no-git-tag-version >/dev/null
NEW_VERSION=$(node -p "require('./package.json').version")
TAG="v$NEW_VERSION"

# Chrome reads the version from manifest.json, so keep it in lockstep with package.json
node -e "const fs=require('fs');const m=require('./manifest.json');m.version='$NEW_VERSION';fs.writeFileSync('./manifest.json',JSON.stringify(m,null,2)+'\n')"

echo
echo "Bumped to $TAG. Building..."
pnpm install
pnpm build

# Package the unpacked extension for the Chrome Web Store (manifest at the zip root)
ZIP="inertia-devtools-extension-$NEW_VERSION.zip"
rm -f "$ZIP"
(cd dist && zip -qr "../$ZIP" .)
echo "Created $ZIP"

# Commit, tag, push, and open a GitHub release with the zip attached
git add -A
git commit -m "$TAG"
git tag -a "$TAG" -m "$TAG"
git push
git push --tags
gh release create "$TAG" "$ZIP" --generate-notes

echo
echo "✅ Release $TAG done."
echo "📦 Upload $ZIP to the Chrome Web Store."
echo "🔗 https://github.com/inertiajs/inertia-devtools/releases/tag/$TAG"
