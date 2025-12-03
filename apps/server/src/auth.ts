import { betterAuth } from 'better-auth';
import { apiKey } from 'better-auth/plugins';
import db from './db.js';

export const auth = betterAuth({
  database: db,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  baseURL: process.env.BETTER_AUTH_BASE_URL || process.env.SERVER_URL || 'http://localhost:3001',
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET || 'change-me-in-production',
  trustedOrigins: (request: Request) => {
    const origin = request.headers.get('origin') || '';

    // In development, allow any origin
    if (process.env.NODE_ENV !== 'production') {
      return origin ? [origin] : ['http://localhost:3000'];
    }

    // In production, use explicit trusted origins from env or default
    const allowedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') || process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];
    return allowedOrigins.includes(origin) ? [origin] : allowedOrigins;
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      partitioned: process.env.NODE_ENV === 'production',
    },
  },
  plugins: [apiKey()],
});
