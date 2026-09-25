// The key's repeated pieces, split out of MscRingKey so that file stays
// one component: a colour chip, one labelled row, and a titled group.
import { SLICE_TOKEN } from "./MscRingPills";

export function Swatch({ background }: { background: string }) {
  return <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background }} />;
}

export function KeyItem({ id, code, label, striped }: { id: string; code?: string; label: string; striped?: boolean }) {
  const color = `var(${SLICE_TOKEN[id] ?? SLICE_TOKEN.kept})`;
  return (
    <span className="msc-key-item" data-key={id}>
      <Swatch
        background={
          striped
            ? `repeating-linear-gradient(45deg, ${color} 0, ${color} 2px, transparent 2px, transparent 4px)`
            : color
        }
      />
      {code ? `${code} · ${label}` : label}
    </span>
  );
}

export function KeyGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="msc-key-group">
      <p className="msc-key-title">{title}</p>
      {children}
    </div>
  );
}
