import { createAuthClient } from "better-auth/react";
import { apiKeyClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: "", // Use relative URL since we're proxying through Vite
  fetchOptions: {
    credentials: "include", // Required for sending cookies cross-origin
  },
  plugins: [
    apiKeyClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
export const { apiKey } = authClient;
