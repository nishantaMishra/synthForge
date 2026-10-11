import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ userId: session.userId });
}
