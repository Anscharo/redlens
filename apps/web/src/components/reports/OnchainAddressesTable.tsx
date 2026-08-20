// The On-Chain Addresses grid. Split out of OnchainAddressesReport.tsx so the
// page file is data + filters + <ReportShell>.
//
// A plain overflow-x-auto div can't host a page-scroll sticky header — per the CSS
// overflow spec, giving overflow-x a non-visible value while overflow-y stays
// "visible" forces overflow-y to also compute as "auto", turning that div into its
// own scroll container. Since the div's height is otherwise unconstrained (it never
// overflows itself), that scroll container has no actual scroll range, so a sticky
// header inside it never sticks. Bounding the height and scrolling for real (an
// actual internal scrollbar) gives position:sticky a genuine range to work within —
// the standard "data grid" pattern for header + horizontal scroll together.
import { shortAddr } from "../../lib/format";
import { explorerUrl } from "@/lib/explorer";
import { HEADER_OFFSET } from "../../lib/layout";
import { addrSearchFields, type OnchainAddressRow } from "../../lib/onchainAddressesIndex";
import { hiddenMatches, type ReportQuery } from "@/lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";
import { TypePill, DocsCell, BalanceCells } from "./OnchainAddressCells";

const HEADERS: [label: string, className: string][] = [
  ["Chain", "w-24"],
  ["Address", "w-44"],
  ["Name", "w-32"],
  ["Type", "w-40"],
  ["Implementation", "w-32"],
  ["Owner", "w-44"],
  ["Docs Mentioned In", ""],
  ["ETH", "text-right"],
  ["USDS", "text-right"],
  ["SKY", "text-right"],
  ["Other Balances", ""],
];

function Row({ r, rq }: { r: OnchainAddressRow; rq: ReportQuery }) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors align-top">
      <td className="py-2 px-3">
        <span className="mono text-xs text-tan-3">
          <Highlight text={r.chain} rq={rq} />
        </span>
      </td>
      <td className="py-2 px-3 relative">
        <MatchAside matches={hiddenMatches(addrSearchFields(r), rq)} rq={rq} />
        <a href={r.explorerUrl} target="_blank" rel="noopener" className="mono text-xs text-accent hover:underline" title={r.address}>
          <Highlight text={shortAddr(r.address, 10, 8)} rq={rq} />
        </a>
      </td>
      <td className="py-2 px-3 max-w-[8rem]">
        {r.registryName ? (
          <div className="flex flex-col">
            <span className="mono text-xs text-tan-2 truncate block" title={r.registryName}>
              <Highlight text={r.registryName} rq={rq} />
            </span>
            <span className="mono text-[9px] text-tan-3">{r.registrySource === "onchain" ? "on-chain" : "chainlog"}</span>
          </div>
        ) : (
          <span className="mono text-[10px] text-tan-3">—</span>
        )}
      </td>
      <td className="py-2 px-3">
        <TypePill t={r.type} />
        {/* Solana only: the pill's bucket is coarse, so the exact account kind
            and the program that owns it sit under it. */}
        {r.accountType && (
          <div
            className="mono text-[9px] text-tan-3 truncate mt-0.5"
            title={`${r.accountType}${r.programOwner ? ` · owned by ${r.programOwnerName ?? "program"} ${r.programOwner}` : ""}`}
          >
            <Highlight text={r.accountType} rq={rq} />
            {r.programOwner && ` · ${r.programOwnerName ?? shortAddr(r.programOwner, 4, 4)}`}
          </div>
        )}
      </td>
      <td className="py-2 px-3">
        {r.implementation ? (
          <a
            href={explorerUrl(r.implementation, { chain: r.chain })}
            target="_blank"
            rel="noopener"
            className="mono text-[11px] text-accent hover:underline"
            title={`implementation: ${r.implementation}`}
          >
            <Highlight text={shortAddr(r.implementation, 6, 4)} rq={rq} />
          </a>
        ) : (
          <span className="mono text-[10px] text-tan-3">—</span>
        )}
      </td>
      <td className="py-2 px-3">
        {r.owner ? (
          <span className="text-xs text-tan-2">
            <Highlight text={r.owner} rq={rq} flex />
          </span>
        ) : (
          <span className="mono text-[10px] text-tan-3">—</span>
        )}
      </td>
      <td className="py-2 px-3">
        <DocsCell row={r} rq={rq} />
      </td>
      <BalanceCells row={r} />
    </tr>
  );
}

export function OnchainAddressesTable({ rows, rq }: { rows: readonly OnchainAddressRow[]; rq: ReportQuery }) {
  return (
    <div className="overflow-auto" style={{ maxHeight: `calc(100vh - ${HEADER_OFFSET}px - 40px)` }}>
      <table className="w-full text-left" style={{ minWidth: "1500px" }}>
        <thead>
          <tr className="text-xs mono text-tan-3 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-[var(--border)] [&>th]:bg-[var(--bg)]">
            {HEADERS.map(([label, cls]) => (
              <th key={label} className={`py-2 px-3 font-normal ${cls}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.rowKey} r={r} rq={rq} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
