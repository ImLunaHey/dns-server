import { logger } from './logger.js';

/**
 * Maximum allowed regex pattern length to prevent ReDoS
 */
const MAX_PATTERN_LENGTH = 1000;

/**
 * Check if a regex pattern is potentially dangerous (ReDoS risk)
 * This is a simple heuristic - patterns with excessive repetition or nested quantifiers
 */
function isPotentiallyDangerous(pattern: string): boolean {
  // Check for excessive repetition patterns that can cause ReDoS
  // Patterns like (a+)+, (a*)*, (a|a)+, etc.
  const dangerousPatterns = [
    /\([^)]*\+\)\+/g, // Nested + quantifiers
    /\([^)]*\*\)\*/g, // Nested * quantifiers
    /\([^)]*\?\)\?/g, // Nested ? quantifiers
    /\([^)]*\+\)\*/g, // + inside *
    /\([^)]*\*\)\+/g, // * inside +
    /\.\*\.\*/g, // Multiple .* patterns
    /\.\+\+\.\+/g, // Multiple .+ patterns
  ];

  return dangerousPatterns.some((dangerousPattern) => dangerousPattern.test(pattern));
}

/**
 * Synchronous regex test with ReDoS protection
 * Since we can't truly interrupt regex execution in JavaScript,
 * we validate pattern complexity and length before execution
 */
export function safeRegexTestSync(pattern: string, input: string): boolean {
  // Validate pattern length
  if (pattern.length > MAX_PATTERN_LENGTH) {
    logger.warn('Regex pattern exceeds maximum length', {
      patternLength: pattern.length,
      maxLength: MAX_PATTERN_LENGTH,
    });
    return false;
  }

  // Check for potentially dangerous patterns
  if (isPotentiallyDangerous(pattern)) {
    logger.warn('Potentially dangerous regex pattern detected - may cause performance issues', {
      pattern: pattern.substring(0, 100),
    });
    // Log warning but still allow execution (admin-configured patterns)
  }

  try {
    const regex = new RegExp(pattern);
    // Use test() which is generally faster than match()
    // Note: We can't truly timeout regex execution in JavaScript,
    // but we've validated the pattern complexity and length
    return regex.test(input);
  } catch {
    // Invalid regex pattern
    return false;
  }
}

/**
 * Validate a regex pattern before storing it
 * Returns { valid: boolean; error?: string }
 */
export function validateRegexPattern(pattern: string): { valid: boolean; error?: string } {
  if (!pattern || pattern.trim() === '') {
    return { valid: false, error: 'Pattern cannot be empty' };
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      valid: false,
      error: `Pattern length (${pattern.length}) exceeds maximum allowed length (${MAX_PATTERN_LENGTH})`,
    };
  }

  // Check for potentially dangerous patterns
  if (isPotentiallyDangerous(pattern)) {
    return {
      valid: false,
      error: 'Pattern contains potentially dangerous constructs that may cause ReDoS',
    };
  }

  // Validate that it's a valid regex
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid regex pattern',
    };
  }
}
