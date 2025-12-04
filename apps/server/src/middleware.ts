import { Context, Next } from 'hono';
import { auth } from './auth.js';
import { logger } from './logger.js';

/**
 * Extract client IP from request headers
 */
function getClientIp(c: Context): string {
  const forwardedFor = c.req.header('x-forwarded-for');
  const realIp = c.req.header('x-real-ip');
  const cfConnectingIp = c.req.header('cf-connecting-ip');
  return forwardedFor?.split(',')[0]?.trim() || realIp?.trim() || cfConnectingIp?.trim() || 'unknown';
}

export async function requireAuth(c: Context, next: Next) {
  const clientIp = getClientIp(c);
  const userAgent = c.req.header('user-agent') || 'unknown';
  const path = c.req.path;

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
          // Log successful API key authentication
          logger.info('API key authentication successful', {
            clientIp,
            userAgent,
            path,
            authMethod: 'api-key',
          });
          await next();
          return;
        } else {
          // Log failed API key authentication
          logger.warn('API key authentication failed: invalid key', {
            clientIp,
            userAgent,
            path,
            authMethod: 'api-key',
          });
        }
      } catch (error) {
        // Log API key verification error
        logger.warn('API key authentication failed: verification error', {
          clientIp,
          userAgent,
          path,
          authMethod: 'api-key',
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall through to session auth
      }
    }

    // Fall back to session auth
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      // Log failed session authentication
      logger.warn('Session authentication failed: no valid session', {
        clientIp,
        userAgent,
        path,
        authMethod: 'session',
      });
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Log successful session authentication
    logger.info('Session authentication successful', {
      clientIp,
      userAgent,
      path,
      authMethod: 'session',
      userId: session.user.id,
    });

    await next();
  } catch (error) {
    // Log authentication error
    logger.error('Authentication error', {
      clientIp,
      userAgent,
      path,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return c.json({ error: 'Unauthorized' }, 401);
  }
}
