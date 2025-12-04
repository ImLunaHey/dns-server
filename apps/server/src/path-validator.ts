import { resolve, normalize } from 'path';
import { logger } from './logger.js';

/**
 * Validate and resolve a file path to prevent path traversal attacks
 *
 * @param filePath - The file path to validate (can be relative or absolute)
 * @param allowedDir - The allowed directory that the file must be within
 * @returns The resolved and validated absolute path
 * @throws Error if the path is invalid or outside the allowed directory
 */
export function validateCertPath(filePath: string, allowedDir: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required and must be a string');
  }

  const trimmed = filePath.trim();

  if (trimmed.length === 0) {
    throw new Error('File path cannot be empty');
  }

  // Check for path traversal attempts
  if (trimmed.includes('../') || trimmed.includes('..\\') || trimmed.includes('..')) {
    throw new Error('File path cannot contain path traversal characters (../ or ..\\)');
  }

  // Check for null bytes (path injection)
  if (trimmed.includes('\0')) {
    throw new Error('File path cannot contain null bytes');
  }

  // Normalize the path to resolve any redundant separators
  const normalized = normalize(trimmed);

  // Resolve the path relative to the allowed directory
  // If the path is already absolute, resolve() will use it as-is
  const resolvedPath = resolve(allowedDir, normalized);

  // Resolve the allowed directory to get its absolute path
  const resolvedAllowedDir = resolve(allowedDir);

  // Ensure the resolved path is within the allowed directory
  // Use startsWith to check if the path is within the directory
  // Add a trailing slash to prevent directory traversal (e.g., /allowed/path-evil)
  const allowedDirWithSlash = resolvedAllowedDir.endsWith('/') ? resolvedAllowedDir : resolvedAllowedDir + '/';

  if (!resolvedPath.startsWith(allowedDirWithSlash) && resolvedPath !== resolvedAllowedDir) {
    logger.error('Path traversal attempt detected', {
      filePath: trimmed,
      resolvedPath,
      allowedDir: resolvedAllowedDir,
    });
    throw new Error(
      `File path resolves outside the allowed directory. Path: ${trimmed}, Resolved: ${resolvedPath}, Allowed: ${resolvedAllowedDir}`,
    );
  }

  return resolvedPath;
}
