#!/usr/bin/env sh
# Publish src/ to the gh-pages branch, which GitHub Pages serves at https://xubynii.github.io/street-flow-lab/
# Run from the repo root after committing to main:  sh tools/publish-pages.sh
set -e
git branch -D gh-pages 2>/dev/null || true
SPLIT=$(git subtree split --prefix=src -q main)
git branch gh-pages "$SPLIT"
git checkout -q gh-pages
touch .nojekyll && git add .nojekyll && git commit -q -m "Publish the app at the site root" || true
git push -f origin gh-pages
git checkout -q main
echo "published: https://xubynii.github.io/street-flow-lab/"
