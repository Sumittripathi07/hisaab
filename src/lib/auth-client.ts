import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// No baseURL: the client calls /api/auth on the page's own origin.
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
