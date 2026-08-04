// Supabase connection. Values come from NEXT_PUBLIC_* env vars when set
// (local: web/.env.local, production: Vercel project settings) and fall
// back to the baked-in project so the app also builds with no env at all.
// The anon key is public by design - RLS and E2E encryption do the
// protecting. Never put service_role keys or the PMS token here.

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hthmmyqbqwmhgqmerohd.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0aG1teXFicXdtaGdxbWVyb2hkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzOTg5NzQsImV4cCI6MjEwMDk3NDk3NH0.nY0oISl7gY3YNsBsN2mt7rxD4I3GP-kqKNSs7nR0xp8';
