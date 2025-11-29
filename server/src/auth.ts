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
  baseURL: 'http://localhost:3001',
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET || 'change-me-in-production',
  trustedOrigins: ['http://localhost:3000'],
  advanced: {
    defaultCookieAttributes: {
      sameSite: 'none',
      secure: true,
      partitioned: true,
    },
  },
  plugins: [
    apiKey(),
  ],
});
