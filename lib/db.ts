import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// PostgreSQL connection will use DATABASE_URL from environment

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn']
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Only connect if DATABASE_URL is a valid PostgreSQL URL
const dbUrl = process.env.DATABASE_URL || '';
if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
  prisma.$connect().catch((error: any) => {
    console.error('Failed to connect to database:', error);
  });
}