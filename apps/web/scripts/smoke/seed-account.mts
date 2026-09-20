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
if (process.env.MULTI) {
  const cred = { accessToken: "fake-token", scopes: ["pages_manage_posts"], expiresAt: new Date(Date.now() + 3600e3) };
  const fb = await prisma.socialAccount.create({
    data: {
      organizationId: process.env.ORG_ID!,
      platform: "FACEBOOK",
      accountType: "PAGE",
      externalAccountId: "page-1",
      displayName: "Acme Facebook Page",
      status: "CONNECTED",
      connectedById: process.env.USER_ID!,
      capabilities: { text: { maxLength: 63206 }, media: { kinds: ["IMAGE", "VIDEO"], maxCount: 10, required: false } },
    },
  });
  await saveSocialCredential(prisma, ring, fb.id, cred);
  const ig = await prisma.socialAccount.create({
    data: {
      organizationId: process.env.ORG_ID!,
      platform: "INSTAGRAM",
      accountType: "BUSINESS",
      externalAccountId: "ig-1",
      username: "acme.coffee",
      displayName: "acme.coffee",
      status: "CONNECTED",
      connectedById: process.env.USER_ID!,
      capabilities: { text: { maxLength: 2200 }, media: { kinds: ["IMAGE", "VIDEO"], maxCount: 10, required: true } },
    },
  });
  await saveSocialCredential(prisma, ring, ig.id, cred);
}
console.log(a.id);
await prisma.$disconnect();
