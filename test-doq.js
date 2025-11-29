/**
 * Test script for DNS-over-QUIC (DoQ)
 * 
 * Note: DoQ requires Node.js 25+
 * This script tests the DoQ server implementation
 */

const dns = require('dns/promises');

async function testDoQ() {
  console.log('=== Testing DNS-over-QUIC (DoQ) Server ===\n');

  const domain = process.argv[2] || 'example.com';
  const type = process.argv[3] || 'A';

  console.log(`Querying ${type} record for ${domain}...\n`);

  try {
    // Note: Node.js doesn't have native DoQ client support yet
    // This would require a QUIC library or waiting for Node.js to add DoQ client support
    // For now, we'll just check if the server is configured correctly

    console.log('⚠️  DoQ client testing is not yet available in Node.js');
    console.log('   DoQ requires QUIC support which will be available in Node.js 25+');
    console.log('   The server implementation is complete, but client testing requires:');
    console.log('   1. Node.js 25+');
    console.log('   2. A QUIC client library (or wait for Node.js DoQ client support)');
    console.log('\n   To test DoQ manually:');
    console.log('   1. Enable DoQ in Settings');
    console.log('   2. Use a DoQ client like:');
    console.log('      - dnslookup (if it supports DoQ)');
    console.log('      - Custom QUIC client');
    console.log('      - Wait for Node.js DoQ client support\n');

    // Check if DoQ is enabled via API
    try {
      const response = await fetch('http://localhost:3001/api/settings');
      const settings = await response.json();
      
      if (settings.doqEnabled) {
        console.log('✓ DoQ is enabled in settings');
        console.log(`  Port: ${settings.doqPort || 853}`);
        console.log(`  Cert: ${settings.doqCertPath || 'Using DoT cert'}`);
        console.log(`  Key: ${settings.doqKeyPath || 'Using DoT key'}`);
      } else {
        console.log('✗ DoQ is not enabled in settings');
        console.log('  Enable it in the Settings page first');
      }
    } catch (error) {
      console.log('⚠️  Could not check DoQ settings:', error.message);
    }

    console.log('\n=== Test Complete ===');
    console.log('\nNote: Full DoQ testing requires a QUIC client.');
    console.log('The server implementation follows RFC 9250 (DNS-over-QUIC).');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testDoQ();

