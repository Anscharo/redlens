export function EntitiesPage({ onNavigate: _ }: { onNavigate: (id: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">entities</p>
        <h1 className="text-xl font-semibold mb-3" style={{ color: 'var(--tan)' }}>Entity Tree</h1>
        <p className="text-sm" style={{ color: 'var(--tan-3)' }}>
          Entity-centric views of the Sky ecosystem — agents, facilitators, governance actors — coming soon.
        </p>
        <p className="text-xs mono mt-4" style={{ color: 'var(--tan-3)' }}>
          Powered by the graph DB layer once Cloudflare Workers + D1 is deployed.
        </p>
      </div>
    </div>
  );
}
