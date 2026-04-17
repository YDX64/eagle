#!/bin/bash

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use Node.js 20
nvm use 20

# Kill any process on port 3000 first
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Start development server
npm run dev