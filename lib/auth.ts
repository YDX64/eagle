/**
 * Authentication configuration.
 *
 * The production probet database doesn't carry a User table — user management
 * is deferred to an upstream identity provider or a simple env-gated admin
 * credential for now. This keeps the Next.js route handlers building without
 * requiring a Prisma User model.
 */
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function requiredSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret === 'your_nextauth_secret_here') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXTAUTH_SECRET is not configured');
    }
    return 'dev-insecure-secret-change-me';
  }
  return secret;
}

export const authOptions: NextAuthOptions = {
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
      name: 'Admin',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminHash = process.env.ADMIN_PASSWORD_HASH;
        if (!adminEmail || !adminHash) return null;
        if (!credentials?.email || !credentials.password) return null;
        if (credentials.email.toLowerCase() !== adminEmail.toLowerCase()) return null;
        const ok = await bcrypt.compare(credentials.password, adminHash);
        if (!ok) return null;
        return {
          id: 'admin',
          email: adminEmail,
          name: 'Admin',
          role: 'admin',
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
