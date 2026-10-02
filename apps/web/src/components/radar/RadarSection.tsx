import { HEADER_OFFSET } from "../../lib/layout";

export function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-8" style={id ? { scrollMarginTop: HEADER_OFFSET } : undefined}>
      <h2
        className="mono text-[10px] uppercase tracking-wider mb-3"
        style={{ color: "var(--tan-3)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
