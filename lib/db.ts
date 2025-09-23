import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// PostgreSQL connection will use DATABASE_URL from environment

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn']
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Gracefully handle connection
prisma.$connect().catch((error: any) => {
  console.error('Failed to connect to database:', error);
});