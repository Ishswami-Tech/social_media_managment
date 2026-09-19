import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";
import { ac, orgRoles } from "./auth-access";

export const authClient = createAuthClient({
  plugins: [adminClient(), organizationClient({ ac, roles: orgRoles })],
});

export const { useSession, signIn, signUp, signOut } = authClient;
