#!/bin/bash
set -e
cd "$(dirname "$0")"

git pull origin main

# Reproducible install from package-lock.json (never mutates the lockfile)
npm ci

# Build while the old server keeps serving from .next; brief blip on restart.
npm run build

pm2 startOrRestart ecosystem.config.js

echo "Deployment complete."
