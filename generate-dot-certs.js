#!/usr/bin/env node

/**
 * Generate self-signed TLS certificates for DNS-over-TLS (DoT) testing
 * Usage: node generate-dot-certs.js [hostname]
 */

import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join } from 'path';

const hostname = process.argv[2] || 'localhost';
const certDir = join(process.cwd(), 'server', 'certs');

console.log('Generating self-signed TLS certificates for DoT...');
console.log(`Hostname: ${hostname}`);
console.log('');

// Create certificates directory
try {
  mkdirSync(certDir, { recursive: true });
} catch (error) {
  // Directory might already exist
}

try {
  console.log('Step 1: Generating private key...');
  execSync(`openssl genrsa -out "${join(certDir, 'dot.key')}" 2048`, {
    stdio: 'inherit',
  });

  console.log('Step 2: Generating self-signed certificate...');
  // Create certificate directly without CSR for simplicity
  execSync(
    `openssl req -new -x509 -key "${join(certDir, 'dot.key')}" -out "${join(certDir, 'dot.crt')}" -days 365 -subj "/C=US/ST=State/L=City/O=DNS Server/CN=${hostname}"`,
    { stdio: 'inherit' },
  );

  console.log('');
  console.log('✓ Certificates generated successfully!');
  console.log(`  Certificate: ${join(certDir, 'dot.crt')}`);
  console.log(`  Private Key: ${join(certDir, 'dot.key')}`);
  console.log('');
  console.log('To enable DoT:');
  console.log('  1. Update settings via API or database:');
  console.log('     dotEnabled: true');
  console.log(`     dotCertPath: ${join(certDir, 'dot.crt')}`);
  console.log(`     dotKeyPath: ${join(certDir, 'dot.key')}`);
  console.log('  2. Restart the DNS server');
  console.log('');
  console.log('Note: These are self-signed certificates for testing only.');
  console.log('For production, use certificates from a trusted CA.');
} catch (error) {
  console.error('');
  console.error('✗ Error generating certificates');
  console.error('');
  console.error('Make sure OpenSSL is installed:');
  console.error('  macOS: Usually pre-installed, or: brew install openssl');
  console.error('  Linux: sudo apt-get install openssl');
  console.error('  Check: openssl version');
  console.error('');
  if (error instanceof Error) {
    console.error('Error details:', error.message);
  }
  process.exit(1);
}

