import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authConfig, cookieOptions, flowCookie } from '../../../../lib/auth';

export const runtime = 'nodejs';

export function GET() {
  const { domain, origin, clientId } = authConfig();
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL('/oauth2/authorize', domain);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${origin}/api/auth/callback`);
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  const response = NextResponse.redirect(url);
  response.cookies.set(flowCookie(), JSON.stringify({ verifier, state }), cookieOptions(600));
  return response;
}
