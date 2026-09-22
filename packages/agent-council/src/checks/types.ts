import type { Platform, PlatformCapabilities } from "@platform/types";
import type { Brief } from "@platform/research";
import type { AccountBrain, CampaignBrief, CheckIssue, ClaimRecord } from "../contracts";

export interface CheckInput {
  /** Post body (hashtags may or may not be included in it). */
  text: string;
  hashtags: string[];
  platform: Platform;
  capabilities: PlatformCapabilities;
  /** Claims ledger for the run; only SUPPORTED ones can back a factual sentence. */
  claims: ClaimRecord[];
  brief: CampaignBrief;
  /** Research brief (its source URLs are allowed in the post). */
  research?: Brief;
  brain: AccountBrain;
  /** Recently published texts of the organization (duplicate detection). */
  recentTexts: string[];
  /** Whether the post will ship with media (concept or asset). */
  hasMedia: boolean;
}

export type Check = (input: CheckInput) => CheckIssue[];

export const issue = (code: string, message: string, severity: CheckIssue["severity"] = "error"): CheckIssue => ({
  code,
  message,
  severity,
});
