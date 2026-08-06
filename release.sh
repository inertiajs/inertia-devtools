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

# Bump package.json without tagging, then read back the resolved version. Both manifests are
# generated from this version at build time (manifest.config.ts), so there is nothing to mirror.
pnpm version "$RELEASE_TYPE" --no-git-tag-version >/dev/null
NEW_VERSION=$(node -p "require('./package.json').version")
TAG="v$NEW_VERSION"

# Re-format so the committed files already match oxfmt, otherwise CI's coding-standards job
# commits a follow-up "Fix code style" change.
pnpm run format >/dev/null

# Commit and push the tag. Pushing the tag triggers the Release workflow, which builds both
# targets and publishes the GitHub release with the Chrome and Firefox zips attached.
git add -A
git commit -m "$TAG"
git tag -a "$TAG" -m "$TAG"
git push
git push --tags

echo
echo "✅ Tagged $TAG and pushed. CI will build, package, and publish the release."
echo "🔗 https://github.com/inertiajs/inertia-devtools/actions"
echo "📦 When the Release workflow finishes, upload the zips: the -chrome one to the Chrome Web Store,"
echo "   the -firefox one to addons.mozilla.org (see BROWSERS.md for the source-code upload it needs)."
