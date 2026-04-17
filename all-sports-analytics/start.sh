#!/bin/bash
# All Sports Analytics - Başlatma Scripti
set -e

cd "$(dirname "$0")"

echo "🏆 All Sports Analytics başlatılıyor..."
echo ""

if [ ! -d "node_modules" ]; then
  echo "📦 İlk kurulum - dependencies yükleniyor..."
  npm install --legacy-peer-deps
fi

echo "✅ Development server port 3030'da başlatılıyor..."
echo "   http://localhost:3030"
echo ""

npm run dev
