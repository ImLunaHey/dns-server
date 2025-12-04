import { createAuthClient } from "better-auth/react";
import { apiKeyClient } from "better-auth/client/plugins";

// Use environment variable for base URL in production, or relative URL in dev
// For IP addresses (including Tailscale), use relative URL to match the page protocol
// For domains, use the full URL from environment
const envAuthUrl =
  import.meta.env.VITE_AUTH_BASE_URL || import.meta.env.VITE_API_URL;
// If env URL is an IP address, use relative URL (works with Tailscale HTTPS)
const isIpAddress =
  envAuthUrl && /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(envAuthUrl);
const AUTH_BASE_URL = isIpAddress
  ? ""
  : envAuthUrl || (import.meta.env.DEV ? "" : "");

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  fetchOptions: {
    credentials: "include", // Required for sending cookies cross-origin
  },
  plugins: [apiKeyClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
export const { apiKey } = authClient;
