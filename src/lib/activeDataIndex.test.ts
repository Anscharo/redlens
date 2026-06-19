// Tests for the Active Data Index report's data-shaping logic.
// Reads the built artifacts in /public — run `pnpm build:index && pnpm build:graph` first if stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, GraphEntity, RelationEdge } from "../types";
import {
  agentFromDocNo,
  agentsFromGraph,
  extractProcess,
  buildChainMap,
  buildActiveDataRows,
  activeDataRowsToCSV,
} from "./activeDataIndex";

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");

type Relations = { meta: unknown; entities: GraphEntity[]; edges: RelationEdge[] };

const relations: Relations = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"),
);
const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"),
).nodes;

const participants = relations.entities.filter((e) => e.et !== "instance");
const graphInput = {
  participants,
  instances: relations.entities.filter((e) => e.et === "instance"),
  edges: relations.edges,
};

const activeDataDocs = Object.values(docs).filter((d) => d.type === "Active Data");
const adEdges = relations.edges.filter((e) => e.e === "active_data_for");
const rows = buildActiveDataRows(docs, graphInput);
const agents = agentsFromGraph(participants, docs);

describe("agentFromDocNo", () => {
  it("matches agent prefixes for every prime agent in the graph", () => {
    // Derived dynamically: robust to agent renaming and renumbering.
    for (const a of agents) {
      expect(agentFromDocNo(`${a.docNo}.2`, agents)).toBe(a.name);
      expect(agentFromDocNo(`${a.docNo}.2.1.1`, agents)).toBe(a.name);
    }
  });
  it("returns null for non-agent doc_nos", () => {
    expect(agentFromDocNo("A.1.1.3.1", agents)).toBeNull();
    expect(agentFromDocNo("A.2.8.1.2", agents)).toBeNull();
  });
});

describe("agentsFromGraph", () => {
  it("includes every prime agent with a defining doc", () => {
    const primes = participants.filter((e) => e.et === "agent" && e.st === "prime" && e.did);
    expect(agents.length).toBe(primes.length);
  });
  it("is ordered by doc_no naturally", () => {
    const sorted = [...agents].sort((a, b) =>
      a.docNo.localeCompare(b.docNo, undefined, { numeric: true }),
    );
    expect(agents.map((a) => a.docNo)).toEqual(sorted.map((a) => a.docNo));
  });
});

describe("extractProcess", () => {
  it("returns 'Alignment Conserver Changes' when phrase is present", () => {
    expect(extractProcess("Edits flow through the Alignment Conserver.")).toBe(
      "Alignment Conserver Changes",
    );
  });
  it("is case-insensitive", () => {
    expect(extractProcess("alignment conserver")).toBe("Alignment Conserver Changes");
  });
  it("defaults to 'Direct Edit'", () => {
    expect(extractProcess("Some unrelated content.")).toBe("Direct Edit");
  });
});

describe("buildChainMap", () => {
  const chainMap = buildChainMap(participants, relations.edges);

  it("includes every prime agent", () => {
    const primes = participants.filter((e) => e.et === "agent" && e.st === "prime");
    expect(chainMap.size).toBe(primes.length);
    for (const p of primes) expect(chainMap.get(p.name)?.agentId).toBe(p.id);
  });

  it("every chain slot is co-present: name null iff id null", () => {
    for (const [agentName, chain] of chainMap) {
      for (const key of ["executor", "facilitator", "govops"] as const) {
        const name = chain[`${key}Name`];
        const id = chain[`${key}Id`];
        expect(name === null, `${agentName}.${key}: name=${String(name)} id=${String(id)}`).toBe(
          id === null,
        );
      }
    }
  });

  it("every executor traces back to an exec edge targeting that prime agent", () => {
    for (const [, chain] of chainMap) {
      if (!chain.executorId) continue;
      const edge = relations.edges.find(
        (e) =>
          (e.e === "operational_executor_agent_for" || e.e === "core_executor_agent_for") &&
          e.t === chain.agentId,
      );
      expect(edge?.f, `${chain.agentName}: executorId doesn't match edge source`).toBe(
        chain.executorId,
      );
    }
  });

  it("every facilitator traces back to a facilitator edge targeting the executor", () => {
    for (const [, chain] of chainMap) {
      if (!chain.facilitatorId || !chain.executorId) continue;
      const edge = relations.edges.find(
        (e) =>
          (e.e === "operational_facilitator_for" || e.e === "core_facilitator_for") &&
          e.t === chain.executorId,
      );
      expect(edge?.f, `${chain.agentName}: facilitatorId doesn't match edge source`).toBe(
        chain.facilitatorId,
      );
    }
  });

  it("every govops traces back to a govops edge targeting the executor", () => {
    for (const [, chain] of chainMap) {
      if (!chain.govopsId || !chain.executorId) continue;
      const edge = relations.edges.find(
        (e) =>
          (e.e === "operational_govops_for" || e.e === "core_govops_for") &&
          e.t === chain.executorId,
      );
      expect(edge?.f, `${chain.agentName}: govopsId doesn't match edge source`).toBe(
        chain.govopsId,
      );
    }
  });
});

describe("buildActiveDataRows", () => {
  it("returns exactly one row per Active Data doc", () => {
    expect(rows.length).toBe(activeDataDocs.length);
    expect(new Set(rows.map((r) => r.activeDataId)).size).toBe(rows.length);
  });

  it("covers every active_data_for edge's source doc", () => {
    const adEdgeSources = new Set(adEdges.map((e) => e.f));
    const rowIds = new Set(rows.map((r) => r.activeDataId));
    for (const id of adEdgeSources) expect(rowIds.has(id)).toBe(true);
  });

  it("is sorted by active data doc_no (natural)", () => {
    const sorted = [...rows].sort((a, b) =>
      a.activeDataDocNo.localeCompare(b.activeDataDocNo, undefined, { numeric: true }),
    );
    expect(rows.map((r) => r.activeDataDocNo)).toEqual(sorted.map((r) => r.activeDataDocNo));
  });

  it("links each row to its controller via active_data_for", () => {
    const ctrlByAd = new Map(adEdges.map((e) => [e.f, e.t]));
    for (const r of rows) {
      const expected = ctrlByAd.get(r.activeDataId) ?? null;
      expect(r.controllerId).toBe(expected);
      if (expected) {
        expect(r.controllerDocNo).toBe(docs[expected]?.doc_no ?? null);
      }
    }
  });

  it("resolves agent iff controller doc_no starts with an agent prefix", () => {
    for (const r of rows) {
      const expectedAgent = r.controllerDocNo ? agentFromDocNo(r.controllerDocNo, agents) : null;
      expect(r.agent).toBe(expectedAgent);
      // Chain is attached only when an agent is set.
      if (!r.agent) expect(r.chain).toBeNull();
      if (r.agent) expect(r.chain?.agentName).toBe(r.agent);
    }
  });

  it("responsibleParty matches the responsible_party_for edge target", () => {
    const respByCtrl = new Map(
      relations.edges.filter((e) => e.e === "responsible_party_for").map((e) => [e.t, e.f]),
    );
    for (const r of rows) {
      if (r.controllerId && respByCtrl.has(r.controllerId)) {
        expect(r.responsibleParty?.id).toBe(respByCtrl.get(r.controllerId));
      } else {
        expect(r.responsibleParty).toBeNull();
      }
    }
  });

  it("every row under a Prime Agent gets an Operational Facilitator", () => {
    for (const r of rows) {
      if (!r.agent) continue;
      if (r.chain?.facilitatorName) {
        expect(r.facilitator?.name).toBe(r.chain.facilitatorName);
        expect(r.facilitator?.role).toBe("Operational Facilitator");
      }
    }
  });

  it("every Sky Core Atlas row (A.1.*) gets the Core Facilitator", () => {
    const coreFacEdge = relations.edges.find((e) => e.e === "core_facilitator_for");
    if (!coreFacEdge) return;
    for (const r of rows) {
      if (r.agent) continue;
      if (!(r.controllerDocNo ?? "").startsWith("A.1.")) continue;
      expect(r.facilitator?.id).toBe(coreFacEdge.f);
      expect(r.facilitator?.role).toBe("Core Facilitator");
    }
  });

  it("ADCs outside agents and Sky Core (A.2.*, accords, …) have no facilitator", () => {
    for (const r of rows) {
      if (r.agent) continue;
      if ((r.controllerDocNo ?? "").startsWith("A.1.")) continue;
      expect(r.facilitator).toBeNull();
    }
  });
});

describe("activeDataRowsToCSV", () => {
  const csv = activeDataRowsToCSV(rows);
  const lines = csv.split("\n");

  // Parse a single line of the form "a","b","c" into cell values.
  // Matches the generator's format (no internal-quote escaping).
  function parseLine(line: string): string[] {
    const cells: string[] = [];
    const re = /"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) cells.push(m[1]);
    return cells;
  }

  it("has a header and one data line per row", () => {
    expect(lines.length).toBe(rows.length + 1);
    expect(lines[0]).toMatch(/^Active Data Doc,/);
  });

  it("quotes every cell — no bare commas in row content leak the column count", () => {
    // Active Data Doc, Title, Controller Doc, Controller Title, Agent,
    // Responsible Party, RP Evidence, Facilitator, Facilitator Role,
    // Facilitator Evidence, Process, Last Edited = 12 cells.
    const expectedQuotes = 12 * 2;
    for (const line of lines.slice(1)) {
      expect((line.match(/"/g) ?? []).length).toBe(expectedQuotes);
    }
  });

  it("each CSV row contains the exact field values shown in the table", () => {
    // Verifies that activeDataRowsToCSV and the ActiveDataReport table render
    // the same underlying data for every row. Null values appear as "" in the CSV
    // and as "—" / "Governance" in the UI — both represent "no data".
    const dataLines = lines.slice(1);
    expect(dataLines.length).toBe(rows.length);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const cells = parseLine(dataLines[i]);
      expect(cells, `row ${i}: wrong cell count`).toHaveLength(12);
      const [
        adDoc, adTitle, ctrlDoc, ctrlTitle, agent,
        rp, rpEvidence, fac, facRole, facEvidence,
        process, lastEdited,
      ] = cells;

      expect(adDoc, `row ${i} activeDataDocNo`).toBe(r.activeDataDocNo);
      expect(adTitle, `row ${i} activeDataTitle`).toBe(r.activeDataTitle);
      expect(ctrlDoc, `row ${i} controllerDocNo`).toBe(r.controllerDocNo ?? "");
      expect(ctrlTitle, `row ${i} controllerTitle`).toBe(r.controllerTitle ?? "");
      expect(agent, `row ${i} agent`).toBe(r.agent ?? "");
      expect(rp, `row ${i} responsibleParty.name`).toBe(r.responsibleParty?.name ?? "");
      expect(rpEvidence, `row ${i} rpEvidence`).toBe(
        (r.responsibleParty?.evidence ?? []).map((s) => s.docNo).join(" → "),
      );
      expect(fac, `row ${i} facilitator.name`).toBe(r.facilitator?.name ?? "");
      expect(facRole, `row ${i} facilitator.role`).toBe(r.facilitator?.role ?? "");
      expect(facEvidence, `row ${i} facEvidence`).toBe(
        (r.facilitator?.evidence ?? []).map((s) => s.docNo).join(" → "),
      );
      expect(process, `row ${i} process`).toBe(r.process);
      expect(lastEdited, `row ${i} lastEdited`).toBe("");
    }
  });

  it("evidence columns match the → chain shown in the table", () => {
    // Find a row that actually has evidence steps to assert a non-trivial value.
    const rowWithEvidence = rows.find((r) => (r.responsibleParty?.evidence.length ?? 0) > 1);
    if (!rowWithEvidence) return; // skip if atlas has no multi-step chains
    const csv = activeDataRowsToCSV([rowWithEvidence]);
    const cells = parseLine(csv.split("\n")[1]);
    const expectedRP = rowWithEvidence.responsibleParty!.evidence.map((s) => s.docNo).join(" → ");
    expect(cells[6]).toBe(expectedRP);
  });

  it("Last Edited column reflects the dates map passed in", () => {
    const sampleRow = rows[0];
    const dates = new Map([[sampleRow.activeDataId, "2025-03-15"]]);
    const csvWithDates = activeDataRowsToCSV([sampleRow], dates);
    const cells = parseLine(csvWithDates.split("\n")[1]);
    expect(cells).toHaveLength(12);
    expect(cells[11]).toBe("2025-03-15");
  });

  it("Last Edited is empty string when no date is available for a row", () => {
    const sampleRow = rows[0];
    const csv = activeDataRowsToCSV([sampleRow], new Map());
    expect(parseLine(csv.split("\n")[1])[11]).toBe("");
  });
});
