#!/bin/bash
set -e

echo "🔨 Building ClaudeLens..."
npm run build

echo "📦 Creating DMG..."
npm run electron:build

echo "✅ Done! DMG created."
