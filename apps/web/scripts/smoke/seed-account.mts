import "dotenv/config";
import { prisma, saveSocialCredential } from "@platform/database";
import { Keyring } from "@platform/encryption";
const ring = Keyring.fromEnv(process.env.ENCRYPTION_KEY!);
const a = await prisma.socialAccount.create({
  data: {
    organizationId: process.env.ORG_ID!,
    platform: "LINKEDIN",
    accountType: "PROFILE",
    externalAccountId: "ext-1",
    displayName: "Ada on LinkedIn",
    status: "CONNECTED",
    connectedById: process.env.USER_ID!,
    capabilities: { text: { maxLength: 3000 }, media: { kinds: ["IMAGE"], maxCount: 9, required: false } },
  },
});
await saveSocialCredential(prisma, ring, a.id, {
  accessToken: "fake-token",
  scopes: ["w_member_social"],
  expiresAt: new Date(Date.now() + 3600e3),
});
// Mirror the app's convention: the token is AAD-bound to the account id after creation.
const wa = await prisma.whatsAppAccount.create({
  data: {
    organizationId: process.env.ORG_ID!,
    wabaId: "WABA1",
    phoneNumberId: process.env.PHONE_NUMBER_ID ?? "PN1",
    displayPhoneNumber: "15550001111",
    accessTokenEncrypted: "pending",
  },
});
await prisma.whatsAppAccount.update({
  where: { id: wa.id },
  data: { accessTokenEncrypted: ring.encrypt("wa-token", `whatsapp-account:${wa.id}`) },
});
console.log(a.id);
await prisma.$disconnect();
