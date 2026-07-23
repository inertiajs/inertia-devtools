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

# Re-format so the committed files already match oxfmt. Otherwise JSON.stringify expands the
# manifest arrays and CI's coding-standards job commits a follow-up "Fix code style" change.
pnpm run format >/dev/null

# Commit and push the tag. Pushing the tag triggers the Release workflow, which builds,
# packages the zip, and publishes the GitHub release with the zip attached.
git add -A
git commit -m "$TAG"
git tag -a "$TAG" -m "$TAG"
git push
git push --tags

echo
echo "✅ Tagged $TAG and pushed. CI will build, package, and publish the release."
echo "🔗 https://github.com/inertiajs/inertia-devtools/actions"
echo "📦 When the Release workflow finishes, grab the zip from the release and upload it to the Chrome Web Store."
