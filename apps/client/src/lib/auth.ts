import { createAuthClient } from "better-auth/react";
import { apiKeyClient } from "better-auth/client/plugins";

// Use environment variable for base URL in production, or relative URL in dev
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "" : "http://localhost:3001");

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  fetchOptions: {
    credentials: "include", // Required for sending cookies cross-origin
  },
  plugins: [
    apiKeyClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
export const { apiKey } = authClient;
