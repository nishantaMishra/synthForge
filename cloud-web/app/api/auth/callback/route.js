import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { accessCookie, authConfig, cookieOptions, flowCookie, verifyAccessToken } from '../../../../lib/auth';

export const runtime = 'nodejs';

function equal(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request) {
  const { domain, origin, clientId } = authConfig();
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL('/', origin));
  response.cookies.delete(flowCookie());

  let flow;
  try {
    flow = JSON.parse(request.cookies.get(flowCookie())?.value || '{}');
  } catch {
    return NextResponse.json({ error: 'Invalid sign-in state' }, { status: 400 });
  }
  const code = url.searchParams.get('code');
  if (!flow.verifier || !flow.state || !code || !equal(url.searchParams.get('state'), flow.state)) {
    return NextResponse.json({ error: 'Invalid sign-in state' }, { status: 400 });
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: flow.verifier,
    redirect_uri: `${origin}/api/auth/callback`,
  });
  const tokenResponse = await fetch(new URL('/oauth2/token', domain), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!tokenResponse.ok) return NextResponse.json({ error: 'Sign-in failed' }, { status: 401 });
  const tokens = await tokenResponse.json();
  if (!tokens.access_token || !tokens.expires_in) {
    return NextResponse.json({ error: 'Invalid token response' }, { status: 502 });
  }
  await verifyAccessToken(tokens.access_token);
  response.cookies.set(accessCookie(), tokens.access_token, cookieOptions(Math.min(tokens.expires_in, 3600)));
  return response;
}
