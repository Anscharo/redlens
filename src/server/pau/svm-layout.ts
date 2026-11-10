// The accounts of the Solana ALM program (keel-fi/svm-alm-controller, build
// v1.0.1, src/state/*.rs): Borsh, one discriminator byte, fixed sizes. A
// decoder throws on an account of any other size or discriminator, because a
// program upgrade that changes a layout must stop the read rather than be
// decoded into wrong numbers. Pure.
import { encodeBase58 } from "../../../scripts/lib/solana-pda.mjs";

/** u64::MAX: a Reserve's or Integration's `max_outflow` when it is unlimited. */
export const U64_MAX = (1n << 64n) - 1n;

export interface SvmLimitState {
  status: "Active" | "Suspended";
  /** Raw units per day. */
  slope: bigint;
  maxOutflow: bigint;
  available: bigint;
}

export interface SvmReserve extends SvmLimitState {
  controller: string;
  mint: string;
}

/** What an Integration does: its config type and the mints it names. */
export interface SvmIntegrationConfig {
  type: "SplTokenExternal" | "CctpBridge" | "LzBridge" | "AtomicSwap" | "Drift" | "Kamino" | "Undefined";
  mint?: string;
  input?: string;
  output?: string;
  spotMarketIndex?: number;
}

export interface SvmIntegration extends SvmLimitState {
  controller: string;
  description: string;
  config: SvmIntegrationConfig;
}

export interface SvmController {
  id: number;
  status: "Frozen" | "Active" | "PushPullFrozen" | "AtomicSwapLock";
  /** The controller's authority PDA, which signs its token moves. */
  authority: string;
}

export interface SvmPermission {
  controller: string;
  authority: string;
  status: "Active" | "Suspended";
  flags: string[];
}

const SIZES = { controller: 166, permission: 105, integration: 508, reserve: 274 } as const;
const DISCRIMINATOR = { controller: 1, permission: 2, integration: 3, reserve: 4 } as const;
const STATUS = ["Suspended", "Active"] as const;
const CONTROLLER_STATUS = ["Frozen", "Active", "PushPullFrozen", "AtomicSwapLock"] as const;
const CONFIG = ["Undefined", "SplTokenExternal", "CctpBridge", "LzBridge", "AtomicSwap", "Drift", "Kamino"] as const;
const FLAGS = ["can_manage_permissions", "can_invoke_external_transfer", "can_execute_swap", "can_reallocate", "can_freeze_controller", "can_unfreeze_controller", "can_manage_reserves_and_integrations", "can_suspend_permissions", "can_liquidate"];

/** A cursor over an account's bytes. */
class Reader {
  private o = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  skip = (n: number) => void (this.o += n);
  at = (o: number) => void (this.o = o);
  pk = () => encodeBase58(this.b.slice(this.o, (this.o += 32)));
  u8 = () => this.b[this.o++];
  u16 = () => new DataView(this.b.buffer, this.b.byteOffset + (this.o += 2) - 2, 2).getUint16(0, true);
  u64 = () => new DataView(this.b.buffer, this.b.byteOffset + (this.o += 8) - 8, 8).getBigUint64(0, true);
  /** A fixed-width text field, its zero padding dropped. */
  text = (n: number) => {
    const raw = this.b.slice(this.o, (this.o += n));
    const end = raw.indexOf(0);
    return new TextDecoder().decode(end < 0 ? raw : raw.slice(0, end));
  };
}

function open(b: Uint8Array, kind: keyof typeof SIZES): Reader {
  if (b.length !== SIZES[kind] || b[0] !== DISCRIMINATOR[kind]) throw new Error(`not a ${kind} account of the known layout (${b.length} bytes, discriminator ${b[0]})`);
  const r = new Reader(b);
  r.skip(1);
  return r;
}

/** The rate-limit fields both a Reserve and an Integration hold: status, then slope, max_outflow and available (remainder and refresh times follow). */
const limitState = (r: Reader): SvmLimitState => ({ status: STATUS[r.u8()], slope: r.u64(), maxOutflow: r.u64(), available: r.u64() });

export function decodeReserve(b: Uint8Array): SvmReserve {
  const r = open(b, "reserve");
  const controller = r.pk();
  const mint = r.pk();
  r.pk();
  return { controller, mint, ...limitState(r) };
}

/** An Integration's config: the enum tag and, for each type, the mints it names (`IntegrationConfig`, 225 bytes). */
function config(r: Reader): SvmIntegrationConfig {
  const type = CONFIG[r.u8()] ?? "Undefined";
  if (type === "SplTokenExternal") return (r.pk(), { type, mint: r.pk() });
  if (type === "CctpBridge") return (r.pk(), r.pk(), { type, mint: r.pk() });
  if (type === "LzBridge") return (r.pk(), { type, mint: r.pk() });
  if (type === "AtomicSwap") return { type, input: r.pk(), output: r.pk() };
  if (type === "Drift") return (r.u16(), { type, spotMarketIndex: r.u16() });
  if (type === "Kamino") return (r.pk(), r.pk(), { type, mint: r.pk() });
  return { type };
}

export function decodeIntegration(b: Uint8Array): SvmIntegration {
  const r = open(b, "integration");
  const controller = r.pk();
  const description = r.text(32);
  r.skip(32);
  const state = limitState(r);
  r.at(1 + 32 + 32 + 32 + 1 + 6 * 8);
  return { controller, description, ...state, config: config(r) };
}

/** A Controller: id, bump, status, authority, authority bump, then padding. */
export function decodeController(b: Uint8Array): SvmController {
  const r = open(b, "controller");
  const id = r.u16();
  r.skip(1);
  return { id, status: CONTROLLER_STATUS[r.u8()], authority: r.pk() };
}

export function decodePermission(b: Uint8Array): SvmPermission {
  const r = open(b, "permission");
  const controller = r.pk();
  const authority = r.pk();
  const status = STATUS[r.u8()];
  return { controller, authority, status, flags: FLAGS.filter(() => r.u8() === 1) };
}

/** A token mint's decimals (byte 44 of the base Mint layout, the same under Token-2022); null for an account too short to be a mint. */
export const mintDecimals = (b: Uint8Array): number | null => (b.length >= 82 ? b[44] : null);
