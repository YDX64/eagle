import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/db';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function requiredSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret === 'your_nextauth_secret_here') {
    // NextAuth refuses to start without a real secret in production. We
    // bubble the failure early instead of producing silently-broken JWTs.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXTAUTH_SECRET is not configured');
    }
    return 'dev-insecure-secret-change-me';
  }
  return secret;
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  secret: requiredSecret(),
  pages: {
    signIn: '/auth/signin',
  },
  providers: [
    CredentialsProvider({
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });
        if (!user || !user.passwordHash) return null;

        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          role: user.role,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role ?? 'user';
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
};

export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  return bcrypt.hash(plaintext, rounds);
}
