import { Context, Next } from 'hono';
import { auth } from './auth.js';

export async function requireAuth(c: Context, next: Next) {
  try {
    // Check for API key first (better-auth uses x-api-key header by default)
    const apiKey = c.req.header('x-api-key');
    if (apiKey) {
      try {
        const result = await auth.api.verifyApiKey({
          body: { key: apiKey },
          headers: c.req.raw.headers,
        });
        if (result.valid) {
          await next();
          return;
        }
      } catch (error) {
        // API key verification failed, fall through to session auth
      }
    }

    // Fall back to session auth
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  } catch (error) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
}
