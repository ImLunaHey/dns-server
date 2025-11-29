#!/bin/bash

# Test script for DNS-over-HTTPS (DoH)

echo "Testing DNS-over-HTTPS (DoH) endpoint..."
echo ""

# Test 1: POST request with a simple DNS query
echo "Test 1: POST request"
echo "Querying example.com A record via DoH..."

# Create a simple DNS query for example.com A record
# This is a minimal valid DNS query packet
DNS_QUERY=$(printf '\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x03com\x00\x00\x01\x00\x01')

curl -X POST http://localhost:3001/dns-query \
  -H "Content-Type: application/dns-message" \
  --data-binary "$DNS_QUERY" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -o /tmp/doh-response.bin

if [ $? -eq 0 ]; then
  echo "Response received (saved to /tmp/doh-response.bin)"
  echo "Response size: $(wc -c < /tmp/doh-response.bin) bytes"
  echo ""
  echo "To decode the response, you can use:"
  echo "  dig @127.0.0.1 example.com +noall +answer"
else
  echo "Request failed"
fi

echo ""
echo "Test 2: GET request (base64url encoded)"
echo "Note: This requires encoding the DNS query in base64url format"
echo "For now, use the POST method above or a DoH client library"

