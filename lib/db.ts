import { neon } from '@neondatabase/serverless';

// Vercel's Neon Postgres integration sets DATABASE_URL (and/or POSTGRES_URL).
// We check both so this works regardless of which env var name Vercel used.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  '';

if (!connectionString) {
  // Don't throw at import time (would break build) — routes that use sql()
  // will fail loudly with a clear message instead if this is ever empty.
  console.warn(
    'No database connection string found. Set DATABASE_URL (or POSTGRES_URL) in your Vercel project env vars.'
  );
}

export const sql = neon(connectionString);
