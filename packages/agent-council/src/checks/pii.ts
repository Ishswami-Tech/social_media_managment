import { issue, type CheckInput } from "./types";
import { briefText } from "./text-utils";

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
// Three digit groups with optional separators; digit count is validated afterwards.
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;

const digits = (s: string): string => s.replace(/\D/g, "");

export function extractEmails(text: string): string[] {
  return text.match(EMAIL_PATTERN) ?? [];
}

export function extractPhones(text: string): string[] {
  return (text.match(PHONE_PATTERN) ?? []).filter((m) => {
    const d = digits(m);
    return d.length >= 10 && d.length <= 15;
  });
}

export const piiCheck = (input: CheckInput) => {
  const allowedText = briefText(input.brief, input.research);
  const allowedEmails = new Set(extractEmails(allowedText).map((e) => e.toLowerCase()));
  const allowedPhones = new Set(extractPhones(allowedText).map(digits));
  const emails = extractEmails(input.text)
    .filter((e) => !allowedEmails.has(e.toLowerCase()))
    .map((e) => issue("pii_email", `Email address "${e}" is not part of the brief`));
  const phones = extractPhones(input.text)
    .filter((p) => !allowedPhones.has(digits(p)))
    .map((p) => issue("pii_phone", `Phone number "${p.trim()}" is not part of the brief`));
  return [...emails, ...phones];
};
