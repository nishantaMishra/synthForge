import { NextResponse } from 'next/server';
import { accessCookie, authConfig } from '../../../../lib/auth';

export async function POST() {
  const response = NextResponse.redirect(new URL('/', authConfig().origin));
  response.cookies.delete(accessCookie());
  return response;
}
