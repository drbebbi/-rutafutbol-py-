#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/drbebbi/-rutafutbol-py-.git"

git init
git branch -M main
git add .
git commit -m "Initial RutaFútbol PY PWA"
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git push -u origin main
