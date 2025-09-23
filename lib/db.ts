import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// FORCE SQLite database usage - override system environment variable
// Fix: Use correct database path without creating nested directory
process.env.DATABASE_URL = "file:./dev.db";

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: "file:./dev.db" // Correct path relative to prisma directory
    }
  }
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Gracefully handle connection
prisma.$connect().catch((error) => {
  console.error('Failed to connect to database:', error);
});