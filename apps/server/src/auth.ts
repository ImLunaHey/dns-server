import { betterAuth } from 'better-auth';
import { apiKey } from 'better-auth/plugins';
import db from './db.js';
import { logger } from './logger.js';

// Validate authentication secret
const authSecret = process.env.BETTER_AUTH_SECRET;
const isProduction = process.env.NODE_ENV === 'production';
const defaultSecret = 'change-me-in-production';

if (!authSecret || authSecret === defaultSecret) {
  const errorMessage =
    'BETTER_AUTH_SECRET must be set to a secure random value. ' + 'Generate one with: openssl rand -base64 32';

  if (isProduction) {
    logger.error(errorMessage);
    throw new Error(errorMessage);
  } else {
    logger.warn(
      `Security warning: ${errorMessage}. ` +
        'This is allowed in development but MUST be fixed before production deployment.',
    );
  }
}

// Validate secret strength in production
if (isProduction && authSecret) {
  if (authSecret.length < 32) {
    const errorMessage =
      'BETTER_AUTH_SECRET must be at least 32 characters long in production. ' +
      'Generate one with: openssl rand -base64 32';
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }
}

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
  secret: authSecret || defaultSecret,
  trustedOrigins: (request: Request) => {
    const origin = request.headers.get('origin') || '';

    // In development, allow any origin
    if (process.env.NODE_ENV !== 'production') {
      return origin ? [origin] : ['http://localhost:3000'];
    }

    // In production, use explicit trusted origins from env or default
    const allowedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') ||
      process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];
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
