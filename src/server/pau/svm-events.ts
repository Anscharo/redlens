// The configuration events of the Solana ALM program (keel-fi/svm-alm-controller,
// build v1.0.1, src/events.rs). Every change to the controller, a Permission,
// a Reserve or an Integration is emitted as an inner EmitEvent instruction to
// the program itself (instruction discriminator 0, then the controller id as
// u16 and the Borsh event as a u32-length vector), carrying the event's
// authority, the controller, the account and its full state before and after
// (each an Option of the account without its discriminator byte). An
// AccountingEvent is a relayer's operation and an OracleUpdate is not a PAU
// account, so both decode to null. An unknown variant, or an event whose
// bytes do not add up, throws: a program upgrade must stop the read rather
// than be decoded into wrong rows. Pure.
import { encodeBase58 } from "../../../scripts/lib/solana-pda.mjs";
import { decodeController, decodeIntegration, decodePermission, decodeReserve } from "./svm-layout.ts";

/** The variants, in the program's enum order. */
const VARIANTS = ["ControllerUpdate", "PermissionUpdate", "ReserveUpdate", "IntegrationUpdate", "AccountingEvent", "OracleUpdate"] as const;
const SKIPPED = new Set(["AccountingEvent", "OracleUpdate"]);

/** Each account kind's discriminator and its state's size in an event (the account's size less the discriminator). */
const STATE = {
  ControllerUpdate: { disc: 1, size: 165, decode: decodeController },
  PermissionUpdate: { disc: 2, size: 104, decode: decodePermission },
  ReserveUpdate: { disc: 4, size: 273, decode: decodeReserve },
  IntegrationUpdate: { disc: 3, size: 507, decode: decodeIntegration },
} as const;

export type SvmEventName = keyof typeof STATE;

/** One configuration change: the account it changed (the controller for a ControllerUpdate) and its state before (null when it was created) and after. */
export interface SvmConfigEvent {
  event: SvmEventName;
  controller: string;
  account: string;
  authority: string;
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
}

/** A decoded state as stored in jsonb: bigints as decimal strings. */
const safe = (v: unknown): unknown => (typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(safe) : v && typeof v === "object" ? jsonSafe(v) : v);
const jsonSafe = (o: object): Record<string, unknown> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, safe(v)]));

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** An EmitEvent instruction's bytes and its event's variant, checked against the vector length it states. */
function emitted(hex: string): { b: Uint8Array; name: (typeof VARIANTS)[number] } {
  const b = fromHex(hex);
  if (b.length < 8 || b[0] !== 0) throw new Error("not an EmitEvent instruction");
  const len = new DataView(b.buffer).getUint32(3, true);
  if (b.length !== 7 + len) throw new Error(`EmitEvent holds ${b.length - 7} bytes, its event says ${len}`);
  const name = VARIANTS[b[7]];
  if (!name) throw new Error(`unknown event variant ${b[7]}`);
  return { b, name };
}

/** The configuration event an EmitEvent instruction's data (hex) carries, or null for an operational one. */
export function decodeEmitEvent(hex: string): SvmConfigEvent | null {
  const { b, name } = emitted(hex);
  if (SKIPPED.has(name)) return null;
  const s = STATE[name as SvmEventName];
  let o = 8;
  const pk = () => encodeBase58(b.slice(o, (o += 32)));
  const state = () => {
    const tag = b[o++];
    if (tag === 0) return null;
    if (tag !== 1) throw new Error(`${name}: ${tag} is not an Option tag`);
    const account = new Uint8Array(s.size + 1);
    account[0] = s.disc;
    account.set(b.slice(o, (o += s.size)), 1);
    return jsonSafe(s.decode(account));
  };
  const authority = pk();
  const controller = pk();
  const account = name === "ControllerUpdate" ? controller : pk();
  const event: SvmConfigEvent = { event: name as SvmEventName, controller, account, authority, old: state(), new: state() };
  if (o !== b.length) throw new Error(`${name} left ${b.length - o} bytes undecoded`);
  return event;
}
