// Security headers (security report S4). The CSP keeps the page to its own
// code and blocks framing; connect-src allows any https:// origin because
// API-kind credit monitors fetch the tool's own API from the browser (the
// Supabase project is https:// too). A non-https Supabase URL (the local
// sandbox mock) is added explicitly. 'unsafe-inline' for scripts is needed
// by Next.js' inline bootstrap scripts on this statically rendered page.
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const extraConnect = /^http:\/\//.test(supabase) ? ` ${new URL(supabase).origin}` : '';

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https:${extraConnect}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
