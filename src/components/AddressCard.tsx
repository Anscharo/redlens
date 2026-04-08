import type { AddressInfo } from "../types";

export function AddressCard({ address, info }: { address: string; info: AddressInfo }) {
  return (
    <div className="py-3 border-b" style={{ borderColor: "var(--border)" }}>
      {info.entityLabel && (
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--tan)" }}>
          {info.entityLabel}
        </p>
      )}
      {info.aliases.length > 0 && (
        <p className="text-xs mb-1" style={{ color: "var(--tan-3)" }}>
          also known as {info.aliases.join(" · ")}
        </p>
      )}
      <a
        href={info.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mono text-xs block mb-2 break-all"
        style={{
          color: "var(--accent)",
          textDecoration: "underline",
          textUnderlineOffset: "3px",
        }}
      >
        {address}
      </a>
      {info.roles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {info.roles.map((role) => (
            <span
              key={role}
              className="mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide"
              style={{
                background: "var(--surface)",
                color: "var(--tan-3)",
                border: "1px solid var(--border)",
              }}
            >
              {role}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
