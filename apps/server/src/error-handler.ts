import { Context } from 'hono';
import { logger } from './logger.js';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Sanitize error message for client response
 * In production, returns generic messages to prevent information disclosure
 */
export function sanitizeErrorMessage(error: unknown, defaultMessage: string = 'An error occurred'): string {
  if (isProduction) {
    // In production, return generic error messages
    return defaultMessage;
  }

  // In development, return more detailed error messages
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Get HTTP status code from error
 */
export function getErrorStatusCode(error: unknown): number {
  // Check for common error types with status codes
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return status;
    }
  }

  // Default to 500 for unknown errors
  return 500;
}

/**
 * Check if error contains sensitive information
 */
function containsSensitiveInfo(message: string): boolean {
  const sensitivePatterns = [
    /sql/i,
    /database/i,
    /schema/i,
    /table/i,
    /column/i,
    /constraint/i,
    /foreign key/i,
    /primary key/i,
    /stack trace/i,
    /at \w+\.\w+/i, // Stack trace patterns
    /file:\/\/\//i, // File paths
    /\/.*\/.*\.(js|ts|tsx)/i, // Source file paths
  ];

  return sensitivePatterns.some((pattern) => pattern.test(message));
}

/**
 * Log error with full details (server-side only)
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  logger.error('Request error', {
    ...context,
    error: error instanceof Error ? error : new Error(String(error)),
    errorMessage,
    errorStack: isProduction ? undefined : errorStack, // Only log stack in development
  });
}

/**
 * Handle error and return appropriate response
 */
export function handleError(c: Context, error: unknown, defaultMessage: string = 'An error occurred'): Response {
  const statusCode = getErrorStatusCode(error);
  const sanitizedMessage = sanitizeErrorMessage(error, defaultMessage);

  // Log full error details server-side
  logError(error, {
    path: c.req.path,
    method: c.req.method,
    statusCode,
  });

  // Return sanitized error to client
  // Map status code to valid Hono status codes
  const validStatus = statusCode >= 400 && statusCode < 600 ? (statusCode as 400 | 401 | 403 | 404 | 500) : 500;
  return c.json({ error: sanitizedMessage }, validStatus);
}

/**
 * Error handling middleware for Hono
 */
export async function errorHandler(c: Context, next: () => Promise<void>): Promise<void> {
  try {
    await next();
  } catch (error) {
    // Handle the error
    handleError(c, error);
  }
}

/**
 * Wrap async route handlers with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  handler: T,
  defaultMessage?: string,
): T {
  return (async (...args: unknown[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      // Extract context from args if available
      const context = args[0] instanceof Object && 'req' in args[0] ? (args[0] as Context) : undefined;
      if (context) {
        handleError(context, error, defaultMessage);
      } else {
        logError(error);
        throw error; // Re-throw if we can't handle it
      }
    }
  }) as T;
}
