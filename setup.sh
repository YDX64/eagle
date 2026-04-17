#!/bin/bash

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use Node.js 20
nvm use 20

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "DATABASE_URL=\"file:./prisma/dev.db\"" > .env
    echo "API_FOOTBALL_KEY=\"your-api-key-here\"" >> .env
    echo "Created .env file. Please add your API_FOOTBALL_KEY"
fi

# Install dependencies with legacy peer deps
npm install --legacy-peer-deps

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name initial

echo "Setup complete!"