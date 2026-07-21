import { useState } from "react";
import type { LibraryNodeRef } from "../../lib/library";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";
import { SegmentedBar, PlainBar } from "./SegmentedBar";

// Small link-out icon; the row text itself is NOT a link (it toggles expansion).
function ReaderLink({ id, label }: { id: string; label: string }) {
  return (
    <Link
      to={atlasHref(id)}
      className="link-accent inline-flex shrink-0"
      aria-label={`Open ${label} in the reader`}
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M5 2.5H2.5v7h7V7" />
        <path d="M7 1.5h3.5V5M10.2 1.8 5.5 6.5" />
      </svg>
    </Link>
  );
}

function ScopeRow({ scope, max, atlasTotal }: { scope: LibraryNodeRef; max: number; atlasTotal: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <div className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(11rem, 16rem) 1fr 3.5rem" }}>
        <span className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-1.5 min-w-0 text-left"
            style={{ color: "var(--tan-2)" }}
          >
            <span
              aria-hidden="true"
              className="mono text-xs shrink-0 transition-transform"
              style={{ color: "var(--tan-3)", transform: open ? "rotate(90deg)" : undefined }}
            >
              ▸
            </span>
            <span className="text-sm truncate">
              {scope.doc_no} {scope.title}
            </span>
          </button>
          <ReaderLink id={scope.id} label={scope.title} />
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="block w-full cursor-pointer">
          <SegmentedBar value={scope.docs} max={max} segments={scope.segments} />
        </button>
        <span className="mono text-xs text-right text-tan-3">{scope.docs.toLocaleString()}</span>
      </div>
      {open && (
        <div className="mt-1 mb-2">
          {scope.segments.map((s) => (
            <div
              key={s.id}
              className="grid items-center gap-2 mb-1"
              style={{ gridTemplateColumns: "minmax(11rem, 16rem) 1fr 3.5rem" }}
            >
              <span className="flex items-center gap-1.5 min-w-0 pl-6">
                <span className="text-xs truncate" style={{ color: "var(--tan-2)" }}>
                  {s.doc_no} {s.title}
                </span>
                <ReaderLink id={s.id} label={s.title} />
              </span>
              <PlainBar value={s.docs} max={atlasTotal} />
              <span className="mono text-xs text-right text-tan-3">{s.docs.toLocaleString()}</span>
            </div>
          ))}
          <p className="pl-6 mono text-xs mt-1" style={{ color: "var(--tan-3)" }}>
            bars scaled to the whole Atlas ({atlasTotal.toLocaleString()} docs)
          </p>
        </div>
      )}
    </div>
  );
}

export function LibraryScopeMass({ scopes, atlasTotal }: { scopes: LibraryNodeRef[]; atlasTotal: number }) {
  const max = Math.max(...scopes.map((s) => s.docs), 1);
  return (
    <div className="mt-3">
      {scopes.map((s) => (
        <ScopeRow key={s.id} scope={s} max={max} atlasTotal={atlasTotal} />
      ))}
    </div>
  );
}
