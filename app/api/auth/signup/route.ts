import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

// Register a new credential-based user. Email/password are minimally
// validated here; the actual session handshake happens via the NextAuth
// Credentials provider at /api/auth/callback/credentials.
const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120).optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { success: false, error: 'Email already registered' },
      { status: 409 }
    );
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(parsed.data.password);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Password invalid' },
      { status: 400 }
    );
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      passwordHash,
    },
    select: { id: true, email: true, name: true, role: true },
  });

  return NextResponse.json({ success: true, user });
}
