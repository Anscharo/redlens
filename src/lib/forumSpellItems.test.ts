// The Operational Facilitator's post pairing each spell item with its Snapshot
// poll and its atlas PRs, in the layout the forum serves (thread 28229, post 5):
// each item's group from the quoted summary, the title only from the paragraph
// right before its links, and items with no PR left out.
import { describe, expect, it } from "vitest";
import { forumTopics, threadSpellDate } from "./atlasPrSpell.ts";
import { postSpellItems } from "./forumSpellItems.ts";

const snap = (c: string) => `0x${c.repeat(64)}`;
const pair = (title: string, s: string, prs: number[]) =>
  `<p>${title}</p>\n<ul>\n<li><a href="https://snapshot.box/#/s:grovefinance.eth/proposal/${s}">Snapshot Poll</a></li>\n${prs.map((n) => `<li><a href="https://github.com/sky-ecosystem/next-gen-atlas/pull/${n}">Pull Request</a></li>`).join("\n")}\n</ul>`;
const post = `<aside class="quote no-group"><blockquote>
<p>New Spell Items</p>
<ol>
<li>[Base] Grove × Steakhouse USDC Vault on Base — Onboard the vault to the Grove Liquidity Layer</li>
<li>[Ethereum] Grove DPAU — Set the USDS burn and USDC→USDS swap rate limits to unlimited</li>
</ol>
<p>Grove Artifact</p>
<ol start="3">
<li>[Grove Artifact] Diamond PAU rate limits — update the recorded values, applied via the cBEAM</li>
</ol>
</blockquote></aside>
<p>These proposals have now been posted and are available for voting on the Grove Snapshot Space.</p>
${pair("[Base] Grove × Steakhouse USDC Vault on Base - Onboard the Vault to the Grove Liquidity Layer", snap("a"), [332])}
${pair("[Ethereum] Grove DPAU - Set the USDS Burn and USDC-to-USDS Swap Rate Limits to <code>unlimited</code>", snap("b"), [336, 341])}
${pair("[Grove Artifact] Diamond PAU Rate Limits - Update the Recorded Values, Applied via the cBEAM", snap("c"), [337])}
<p>Discussion</p>
<ul><li><a href="https://forum.skyeco.com/t/x/1">thread</a></li></ul>`;

describe("postSpellItems", () => {
  it("pairs each item with its Snapshot poll and every PR, and its summary group", () => {
    const items = postSpellItems(post, 28229, 5, "2026-09-24");
    expect(items.map((i) => [i.prs, i.group, i.snapshot])).toEqual([
      [[332], "spell", snap("a")],
      [[336, 341], "spell", snap("b")],
      [[337], "artifact", snap("c")],
    ]);
    expect(items[0]).toMatchObject({ topic: 28229, post: 5, threadDate: "2026-09-24", title: "[Base] Grove × Steakhouse USDC Vault on Base - Onboard the Vault to the Grove Liquidity Layer" });
  });
  it("takes the group from the title where the post has no summary", () => {
    const bare = `<p><strong>[Grove Artifact] UniswapV3 Facet - Offchain Parameter Update</strong></p>\n<ul><li><a href="https://snapshot.box/#/s:grovefinance.eth/proposal/${snap("d")}">Snapshot Poll</a></li><li><a href="https://github.com/sky-ecosystem/next-gen-atlas/pull/340">Pull Request</a></li></ul>`;
    expect(postSpellItems(bare, 1, 10, null)).toMatchObject([{ prs: [340], group: "artifact", title: "[Grove Artifact] UniswapV3 Facet - Offchain Parameter Update" }]);
    expect(postSpellItems(bare.replace("[Grove Artifact] ", "[Ethereum] "), 1, 10, null)[0].group).toBeNull();
  });
});

describe("thread helpers", () => {
  it("reads a spell thread's date from its slug, and the topics a text links", () => {
    expect(threadSpellDate("november-5-2026-proposed-changes-to-grove-for-upcoming-spell")).toBe("2026-11-05");
    expect(threadSpellDate("technical-scope-morpho-vault-timelock-compliance")).toBeNull();
    expect(forumTopics("see https://forum.skyeco.com/t/november-5-2026-proposed-changes-to-grove-for-upcoming-spell/28336/ and forum.skyeco.com/t/28229/9")).toEqual([28336, 28229]);
  });
});
