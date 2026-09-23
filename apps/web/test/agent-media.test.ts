import { describe, expect, it } from "vitest";
import { imagePromptFor, imageSizeFor, planRunMedia } from "../lib/agent/media";

const li = { runAccountId: "acc_li", platform: "LINKEDIN", mediaConcept: "A carousel about cold brew", mediaAssetIds: [] };
const ig = { runAccountId: "acc_ig", platform: "INSTAGRAM", mediaConcept: "Square hero shot", mediaAssetIds: [] };

describe("planRunMedia", () => {
  it("makes images only for accounts that asked or cannot post without one", () => {
    expect(planRunMedia({ topic: "t", wantsImage: false }, [li, ig]).map((p) => p.runAccountId)).toEqual(["acc_ig"]);
    expect(planRunMedia({ topic: "t", wantsImage: true }, [li, ig]).map((p) => p.runAccountId)).toEqual(["acc_li", "acc_ig"]);
  });

  it("skips accounts that already carry media or have no concept", () => {
    const withMedia = { ...li, mediaAssetIds: ["asset_1"] };
    const noConcept = { ...ig, mediaConcept: "   " };
    expect(planRunMedia({ topic: "t", wantsImage: true }, [withMedia, noConcept])).toEqual([]);
  });

  it("picks a square image for square feeds and landscape elsewhere", () => {
    expect(imageSizeFor("INSTAGRAM")).toBe("1024x1024");
    expect(imageSizeFor("LINKEDIN")).toBe("1536x1024");
    expect(planRunMedia({ topic: "t", wantsImage: true }, [li])[0]!.size).toBe("1536x1024");
  });

  it("frames the concept as a prompt that names the topic and platform", () => {
    const prompt = imagePromptFor("Cold brew season", "LINKEDIN", "  Bold title slide  ");
    expect(prompt).toContain("linkedin post about: Cold brew season");
    expect(prompt).toContain("Visual brief: Bold title slide");
    expect(prompt).toContain("no text unless the brief asks");
  });
});
