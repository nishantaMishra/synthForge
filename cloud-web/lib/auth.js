import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { cookies } from 'next/headers';

const ACCESS_COOKIE = 'synth_access';
const FLOW_COOKIE = 'synth_auth_flow';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for cloud sign-in`);
  return value;
}

export function authConfig() {
  const domain = new URL(required('COGNITO_DOMAIN'));
  if (domain.protocol !== 'https:') throw new Error('COGNITO_DOMAIN must use HTTPS');
  const origin = new URL(required('APP_ORIGIN'));
  if (origin.pathname !== '/') throw new Error('APP_ORIGIN must be an origin');
  return {
    domain: domain.origin,
    origin: origin.origin,
    clientId: required('COGNITO_CLIENT_ID'),
    userPoolId: required('COGNITO_USER_POOL_ID'),
  };
}

export function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

export function flowCookie() {
  return FLOW_COOKIE;
}

export function accessCookie() {
  return ACCESS_COOKIE;
}

export async function verifyAccessToken(token) {
  const { clientId, userPoolId } = authConfig();
  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: 'access',
  });
  const claims = await verifier.verify(token);
  return { userId: claims.sub, claims };
}

export async function getSession() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifyAccessToken(token);
  } catch {
    return null;
  }
}
