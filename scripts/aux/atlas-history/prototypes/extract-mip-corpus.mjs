// Extract the six Atlas v1 MIPs into a section corpus for lineage matching.
// Output: mip-corpus.json — [{ mip, mipTitle, sec, title, depth, content }]
import fs from "node:fs";
import path from "node:path";

const MIPS_DIR = "/private/tmp/claude-502/-Users-m7-lens/6d7b89bd-66ed-458f-82e7-01cccffb710e/scratchpad/mips";
const OUT = "/private/tmp/claude-502/-Users-m7-lens/6d7b89bd-66ed-458f-82e7-01cccffb710e/scratchpad/mip-corpus.json";

// The six Atlas v1 artifacts (poll #25010: MIP101 + five scope BMAAs), tier "core";
// plus the atlas-adjacent process/framework MIPs whose verbiage fed v2, tier "adjacent".
const MIPS = [
  { mip: 101, title: "Maker Atlas Immutable Alignment Artifact", scope: "A.0", tier: "core" },
  { mip: 113, title: "Governance Scope BMAA", scope: "A.1", tier: "core" },
  { mip: 106, title: "Support Scope BMAA", scope: "A.2", tier: "core" },
  { mip: 104, title: "Stability Scope BMAA", scope: "A.3", tier: "core" },
  { mip: 107, title: "Protocol Scope BMAA", scope: "A.4", tier: "core" },
  { mip: 108, title: "Accessibility Scope BMAA", scope: "A.5", tier: "core" },
  { mip: 102, title: "Endgame MIP Amendment and Removal Process", scope: null, tier: "adjacent" },
  { mip: 103, title: "The Stability and Liquidity Scope Framework", scope: null, tier: "adjacent" },
  { mip: 105, title: "The Real-World Asset Collateral Scope Framework", scope: null, tier: "adjacent" },
  { mip: 109, title: "The Physical Resilience Scope Framework", scope: null, tier: "adjacent" },
  { mip: 110, title: "The Interface Scope Framework", scope: null, tier: "adjacent" },
  { mip: 111, title: "The Infrastructure Scope Framework", scope: null, tier: "adjacent" },
  { mip: 112, title: "The Finance Scope Framework", scope: null, tier: "adjacent" },
];

// Heading forms seen in the MIPs:
//   ## 2: Atlas Immutable Alignment Artifact
//   ### 2.1 Principles of Atlas Interpretation   (colon optional)
//   #### 2.2.1                                    (numbered, no title)
//   ### Organizational Alignment                  (title only, MIP101 defs)
const HEAD_RE = /^(#{1,6})\s+(?:(\d+(?:\.\d+)*[A-Z]?)\s*:?\s*)?(.*)$/;

const sections = [];
for (const { mip, title: mipTitle, scope, tier } of MIPS) {
  const file = path.join(MIPS_DIR, `MIP${mip}`, `MIP${mip}.md`);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let cur = null;
  const flush = () => {
    if (cur) {
      cur.content = cur.body.join("\n").trim();
      delete cur.body;
      sections.push(cur);
    }
  };
  for (const line of lines) {
    const m = line.match(HEAD_RE);
    if (m && line.startsWith("#")) {
      flush();
      const [, hashes, sec, rest] = m;
      cur = {
        mip, mipTitle, scope, tier,
        sec: sec || null,
        title: rest.trim() || null,
        depth: hashes.length,
        body: [],
      };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  flush();
}

// drop empty preamble stubs but keep numbered no-title sections (they carry content)
const kept = sections.filter((s) => s.content.length > 0 || s.title);
fs.writeFileSync(OUT, JSON.stringify(kept, null, 1));

const byMip = {};
for (const s of kept) byMip[s.mip] = (byMip[s.mip] || 0) + 1;
console.log("sections kept:", kept.length, JSON.stringify(byMip));
console.log("total content bytes:", kept.reduce((a, s) => a + s.content.length, 0));
