#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/../../../claudelens-app" && pwd)"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "Errore: cartella $PROJECT_DIR non trovata"
    exit 1
fi

cd "$PROJECT_DIR"

echo "Building ClaudeLens..."
npm run build

echo "Creating DMG..."
npm run electron:build

echo "DMG creato con successo!"
