import { cookies } from 'next/headers';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';

export const ROLES: Role[] = ['admin', 'presales_agent', 'vertical_head', 'sales_counsellor', 'data_team'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  presales_agent: 'Pre-Sales Agent',
  vertical_head: 'Vertical Head',
  sales_counsellor: 'Sales Counsellor',
  data_team: 'Data Team',
};

export function roleHomePath(role: Role): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'presales_agent':
      return '/dashboard';
    case 'data_team':
      return '/admin';
    case 'vertical_head':
    case 'sales_counsellor':
      return '/qualified-leads';
    default:
      return '/login';
  }
}

export type SessionUser = {
  id: number;
  name: string;
  role: Role;
};

const COOKIE_NAME = 'mini_crm_session';

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return 'dev-only-insecure-secret-change-me';
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

// Reversible PIN storage, kept alongside (never instead of) the bcrypt hash
// above — login always verifies against the bcrypt hash, unaffected by any
// of this. This exists purely so Admin can look up a user's current PIN in
// the Users tab, per explicit request, understanding the tradeoff: anyone
// with admin access (or raw database access) could decrypt these. Keyed off
// SESSION_SECRET so no extra environment variable is needed.
function getPinKey(): Buffer {
  return crypto.createHash('sha256').update(getSecret()).digest();
}

export function encryptPin(pin: string): string {
  const key = getPinKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), encrypted.toString('base64'), authTag.toString('base64')].join('.');
}

/** Returns null if the value can't be decrypted (e.g. a legacy user whose PIN was only ever bcrypt-hashed, never encrypted, before this feature existed). */
export function decryptPin(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const [ivB64, dataB64, tagB64] = stored.split('.');
    if (!ivB64 || !dataB64 || !tagB64) return null;
    const key = getPinKey();
    const iv = Buffer.from(ivB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function encodeSession(user: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(user)).toString('base64url');
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function decodeSession(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = sign(payload);
  if (sig.length !== expectedSig.length) return null;
  const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  if (!valid) return null;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const user = JSON.parse(json);
    if (
      typeof user.id === 'number' &&
      typeof user.name === 'string' &&
      ROLES.includes(user.role)
    ) {
      return user as SessionUser;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  return decodeSession(token);
}

export async function setSessionCookie(user: SessionUser) {
  const store = await cookies();
  store.set(COOKIE_NAME, encodeSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
