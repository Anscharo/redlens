// @vitest-environment jsdom
// Every kind of change-history heading, and the lines of a change no dedicated
// line describes: a group says what made its changes, never more than the
// chain proves.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PauChange, PauHistoryEntry, PauOrigin } from "../../lib/pau";
import type { TimelineGroup } from "@/lib/pauTimeline";
import { PauTimelineHeader } from "./PauTimelineHeader";
import { PauChangeLine } from "./PauChangeLine";

afterEach(cleanup);

const A = "0x" + "a".repeat(40);
const origin = (o: Partial<PauOrigin>): PauOrigin => ({ kind: "unknown", path: null, spell: null, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "waiting on the StarGuard's cursor", ...o });
const entry = (o: PauOrigin | null): PauHistoryEntry => ({ chain: "ethereum", tx: "0xt", block: 1, time: "2026-10-01T00:00:00Z", primes: [], origin: o, executive: null, changes: [] });
const group = (kind: TimelineGroup["kind"], o: PauOrigin | null, extra: Partial<TimelineGroup> = {}): TimelineGroup => ({ key: kind, kind, time: "2026-10-01T00:00:00Z", spell: null, executive: null, entries: [entry(o)], ...extra });

describe("PauTimelineHeader", () => {
  it("shows a spell no executive record names by its address", () => {
    render(<PauTimelineHeader g={group("executive", origin({ kind: "spell" }), { spell: A })} />);
    expect(screen.getByText("no executive record names this spell")).toBeInTheDocument();
  });

  it("names the operator, with BeamState's bounds when known", () => {
    const { rerender } = render(<PauTimelineHeader g={group("operator", origin({ kind: "operator", to: A }))} beam={{ beamState: A, hop: "57600", maxChange: "1200000000000000000", historyComplete: true, defaults: [] }} />);
    expect(screen.getByText(/through the Configurator, without a spell/)).toBeInTheDocument();
    expect(screen.getByText(/up to 1\.2× per step, one step per key every 16 h/)).toBeInTheDocument();
    rerender(<PauTimelineHeader g={group("operator", origin({ kind: "operator", to: A }))} />);
    expect(screen.queryByText(/within BeamState bounds/)).toBeNull();
  });

  it("shows an unproven relay without a spell", () => {
    render(<PauTimelineHeader g={group("relayed", origin({ kind: "relayed", relay: { executor: A, actionsSet: 6 } as PauOrigin["relay"] }))} />);
    expect(screen.getByText(/action set 6 on Executor/)).toBeInTheDocument();
    expect(screen.getByText(/no bridge message id proves which spell queued it/)).toBeInTheDocument();
  });

  it("names a direct caller, and says when an origin is not resolved", () => {
    render(<PauTimelineHeader g={group("direct", origin({ kind: "direct", from: A }))} />);
    expect(screen.getByText(/Direct call by/)).toBeInTheDocument();
    cleanup();
    render(<PauTimelineHeader g={group("unknown", origin({}))} />);
    expect(screen.getByTitle("waiting on the StarGuard's cursor")).toHaveTextContent("Origin not resolved yet");
  });
});

describe("PauChangeLine", () => {
  const names = { derived: new Map(), keyIndex: new Map() };
  const change = (o: Partial<PauChange>): PauChange => ({ deployments: [], contract: A, role: "controller", event: "MaxSlippageSet", args: {}, subject: null, label: null, before: null, ...o });

  it("lists every argument but the subject for an event with no account", () => {
    render(<ul><PauChangeLine c={change({ subject: A, args: { pool: A, maxSlippage: "999" } })} chain="ethereum" names={names as never} /></ul>);
    const li = screen.getByRole("listitem");
    expect(li).toHaveTextContent("MaxSlippageSet");
    expect(li).toHaveTextContent("maxSlippage 999");
    expect(li).not.toHaveTextContent(`pool ${A}`);
  });

  it("shows a role grant's account as an address", () => {
    render(<ul><PauChangeLine c={change({ event: "RoleGranted", subject: "0xrole", label: "RELAYER", args: { role: "0xrole", account: A } })} chain="ethereum" names={names as never} /></ul>);
    expect(screen.getByRole("listitem")).toHaveTextContent("RoleGranted RELAYER");
  });
});
