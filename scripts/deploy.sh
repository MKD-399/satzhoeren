#!/usr/bin/env bash
# deploy.sh — publish dist/ to the gh-pages branch with plain git.
# (The gh-pages npm package passes every file path on one command line and
#  dies with ENAMETOOLONG on Windows once the site has a few thousand MP3s.)
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/audio-manifest.mjs
npx vite build

WT=".gh-pages-worktree"
git worktree remove --force "$WT" 2>/dev/null || true
git fetch -q origin gh-pages
git worktree add -q "$WT" gh-pages

# Replace the branch contents with the fresh build (keep .git only).
find "$WT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r dist/. "$WT"/
touch "$WT/.nojekyll"

cd "$WT"
git add -A
if git diff --cached --quiet; then
  echo "gh-pages: nothing changed"
else
  git -c user.name="mkd-399" commit -q -m "deploy: ${1:-site}"
  git push -q origin gh-pages
  echo "gh-pages: pushed $(git rev-parse --short HEAD)"
fi
cd ..
git worktree remove --force "$WT"
