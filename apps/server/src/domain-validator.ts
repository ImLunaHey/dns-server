import { logger } from './logger.js';

/**
 * Maximum domain name length (RFC 1123)
 */
const MAX_DOMAIN_LENGTH = 253;

/**
 * Maximum label length (RFC 1123)
 */
const MAX_LABEL_LENGTH = 63;

/**
 * Validate if a string is a valid domain name
 * Follows RFC 1123 domain name rules
 *
 * @param domain - Domain name to validate
 * @returns Object with valid boolean and optional error message
 */
export function validateDomain(domain: string): { valid: boolean; error?: string } {
  if (!domain || typeof domain !== 'string') {
    return { valid: false, error: 'Domain is required and must be a string' };
  }

  const trimmed = domain.trim();

  // Check for empty domain
  if (trimmed.length === 0) {
    return { valid: false, error: 'Domain cannot be empty' };
  }

  // Check maximum length
  if (trimmed.length > MAX_DOMAIN_LENGTH) {
    return {
      valid: false,
      error: `Domain length (${trimmed.length}) exceeds maximum allowed length (${MAX_DOMAIN_LENGTH})`,
    };
  }

  // Check for path traversal attempts
  if (trimmed.includes('../') || trimmed.includes('..\\') || trimmed.includes('..')) {
    return { valid: false, error: 'Domain cannot contain path traversal characters' };
  }

  // Check for control characters
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { valid: false, error: 'Domain cannot contain control characters' };
  }

  // Split into labels
  const labels = trimmed.split('.');

  // Check for empty labels (consecutive dots or leading/trailing dots)
  if (labels.some((label) => label.length === 0)) {
    return { valid: false, error: 'Domain cannot have empty labels (consecutive or leading/trailing dots)' };
  }

  // Validate each label
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];

    // Check label length
    if (label.length > MAX_LABEL_LENGTH) {
      return {
        valid: false,
        error: `Label "${label}" length (${label.length}) exceeds maximum allowed length (${MAX_LABEL_LENGTH})`,
      };
    }

    // Check label format (RFC 1123)
    // Labels can contain: letters, numbers, hyphens
    // Must start and end with alphanumeric character
    // Hyphens are allowed in the middle
    const labelRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

    // Special case: root domain (single dot or empty after split)
    if (label.length === 0 && labels.length === 1) {
      return { valid: false, error: 'Root domain is not allowed' };
    }

    // Special case: allow underscore in labels (for SRV records, etc.)
    // But still validate the basic structure
    const labelWithUnderscore = label.replace(/_/g, '');
    if (labelWithUnderscore.length > 0 && !labelRegex.test(labelWithUnderscore)) {
      return {
        valid: false,
        error: `Label "${label}" contains invalid characters. Labels must start and end with alphanumeric characters and can contain letters, numbers, hyphens, and underscores.`,
      };
    }
  }

  // Check for wildcard domains (allow but log)
  if (trimmed.startsWith('*.')) {
    logger.debug('Wildcard domain detected', { domain: trimmed });
    // Validate the part after *.
    const afterWildcard = trimmed.substring(2);
    if (afterWildcard.length === 0) {
      return { valid: false, error: 'Wildcard domain must have a domain after the wildcard' };
    }
    // Recursively validate the domain part
    const subdomainValidation = validateDomain(afterWildcard);
    if (!subdomainValidation.valid) {
      return { valid: false, error: `Invalid wildcard domain: ${subdomainValidation.error}` };
    }
  }

  return { valid: true };
}

/**
 * Validate and normalize a domain name
 * Returns the normalized domain or throws an error
 *
 * @param domain - Domain name to validate and normalize
 * @returns Normalized domain name
 * @throws Error if domain is invalid
 */
export function validateAndNormalizeDomain(domain: string): string {
  const validation = validateDomain(domain);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid domain name');
  }
  return domain.trim().toLowerCase();
}
