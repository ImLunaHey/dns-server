import { Context } from 'hono';
import { logger } from './logger.js';

/**
 * Validate if a string is a valid IPv4 address
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255;
  });
}

/**
 * Validate if a string is a valid IPv6 address
 */
function isValidIPv6(ip: string): boolean {
  // Basic IPv6 validation (simplified - covers most cases)
  // IPv6 can be in various formats: full, compressed, with brackets, etc.
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.substring(1, ip.length - 1);
  }

  // Check for IPv4-mapped IPv6 (::ffff:192.168.1.1)
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      const ipv4Part = parts.join('.');
      if (isValidIPv4(ipv4Part)) {
        return ip.startsWith('::ffff:') || ip.startsWith('::FFFF:');
      }
    }
    return false;
  }

  // Basic IPv6 format check
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  if (!ipv6Regex.test(ip)) return false;

  // Check for valid hex segments
  const segments = ip.split(':');
  if (segments.length > 8) return false;

  return segments.every((segment) => {
    if (segment === '') return true; // Empty segment allowed for compression
    const num = parseInt(segment, 16);
    return !isNaN(num) && num >= 0 && num <= 0xffff;
  });
}

/**
 * Validate if an IP address is valid (IPv4 or IPv6)
 */
export function isValidIP(ip: string): boolean {
  if (!ip || ip.trim() === '') return false;
  const trimmed = ip.trim();
  return isValidIPv4(trimmed) || isValidIPv6(trimmed);
}

/**
 * Get trusted proxy IPs from environment variable
 * Format: comma-separated list of IP addresses or CIDR ranges
 */
function getTrustedProxies(): string[] {
  const trustedProxiesEnv = process.env.TRUSTED_PROXIES;
  if (!trustedProxiesEnv) {
    return [];
  }
  return trustedProxiesEnv
    .split(',')
    .map((proxy) => proxy.trim())
    .filter((proxy) => proxy.length > 0);
}

/**
 * Check if an IP is in a CIDR range (simplified - only supports /24, /16, /8 for IPv4)
 */
function isIPInCIDR(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) {
    // Exact match
    return ip === cidr;
  }

  const [network, prefixLength] = cidr.split('/');
  const prefix = parseInt(prefixLength, 10);

  if (isValidIPv4(ip) && isValidIPv4(network)) {
    const ipParts = ip.split('.').map((p) => parseInt(p, 10));
    const netParts = network.split('.').map((p) => parseInt(p, 10));

    if (prefix === 24) {
      return ipParts[0] === netParts[0] && ipParts[1] === netParts[1] && ipParts[2] === netParts[2];
    } else if (prefix === 16) {
      return ipParts[0] === netParts[0] && ipParts[1] === netParts[1];
    } else if (prefix === 8) {
      return ipParts[0] === netParts[0];
    }
  }

  // For other cases, do exact match
  return ip === network;
}

/**
 * Check if the connection remote address is from a trusted proxy
 */
function isFromTrustedProxy(remoteAddress: string | undefined, trustedProxies: string[]): boolean {
  if (!remoteAddress) return false;

  // Remove port if present (e.g., "192.168.1.1:12345" -> "192.168.1.1")
  const ip = remoteAddress.split(':')[0];

  if (trustedProxies.length === 0) {
    // If no trusted proxies configured, only trust localhost/private IPs in development
    if (process.env.NODE_ENV !== 'production') {
      return (
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        ip.startsWith('172.16.') ||
        ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') ||
        ip.startsWith('172.19.') ||
        ip.startsWith('172.20.') ||
        ip.startsWith('172.21.') ||
        ip.startsWith('172.22.') ||
        ip.startsWith('172.23.') ||
        ip.startsWith('172.24.') ||
        ip.startsWith('172.25.') ||
        ip.startsWith('172.26.') ||
        ip.startsWith('172.27.') ||
        ip.startsWith('172.28.') ||
        ip.startsWith('172.29.') ||
        ip.startsWith('172.30.') ||
        ip.startsWith('172.31.')
      );
    }
    return false;
  }

  return trustedProxies.some((proxy) => isIPInCIDR(ip, proxy));
}

/**
 * Extract and validate client IP from request
 *
 * Security considerations:
 * - Only trusts proxy headers if request comes from a trusted proxy
 * - Validates all IP addresses
 * - Falls back to connection remote address
 * - Logs suspicious IP spoofing attempts
 */
export function getClientIp(c: Context): string {
  // Get connection remote address (most reliable source)
  // Try to get from the underlying request socket
  let remoteAddress: string | undefined;
  try {
    const raw = c.req.raw as any;
    if (raw.socket?.remoteAddress) {
      remoteAddress = raw.socket.remoteAddress;
    } else if (raw.connection?.remoteAddress) {
      remoteAddress = raw.connection.remoteAddress;
    }
  } catch {
    // Ignore errors accessing socket
  }

  // Get trusted proxies configuration
  const trustedProxies = getTrustedProxies();

  // Check if we should trust proxy headers
  const shouldTrustProxyHeaders = isFromTrustedProxy(remoteAddress, trustedProxies);

  // Extract IPs from proxy headers
  const forwardedFor = c.req.header('x-forwarded-for');
  const realIp = c.req.header('x-real-ip');
  const cfConnectingIp = c.req.header('cf-connecting-ip');

  // If we trust proxy headers, use them (in order of preference)
  if (shouldTrustProxyHeaders) {
    // Cloudflare's header is most reliable when present
    if (cfConnectingIp) {
      const ip = cfConnectingIp.trim();
      if (isValidIP(ip)) {
        return ip;
      }
      logger.warn('Invalid IP in cf-connecting-ip header', { ip, remoteAddress });
    }

    // X-Real-IP is typically set by nginx
    if (realIp) {
      const ip = realIp.trim();
      if (isValidIP(ip)) {
        return ip;
      }
      logger.warn('Invalid IP in x-real-ip header', { ip, remoteAddress });
    }

    // X-Forwarded-For can contain multiple IPs (client, proxy1, proxy2, ...)
    // The first IP is typically the original client
    if (forwardedFor) {
      const firstIp = forwardedFor.split(',')[0]?.trim();
      if (firstIp && isValidIP(firstIp)) {
        return firstIp;
      }
      if (firstIp) {
        logger.warn('Invalid IP in x-forwarded-for header', { ip: firstIp, remoteAddress });
      }
    }
  } else if (forwardedFor || realIp || cfConnectingIp) {
    // Proxy headers present but not from trusted proxy - potential spoofing attempt
    logger.warn('Proxy headers present but request not from trusted proxy - potential IP spoofing', {
      remoteAddress,
      forwardedFor,
      realIp,
      cfConnectingIp,
      trustedProxies,
    });
  }

  // Fall back to connection remote address
  if (remoteAddress) {
    const ip = remoteAddress.split(':')[0]; // Remove port if present
    if (isValidIP(ip)) {
      return ip;
    }
    logger.warn('Invalid remote address', { remoteAddress, ip });
  }

  // Last resort: return 'unknown' if we can't determine a valid IP
  return 'unknown';
}
