export async function fetchRemoteNodes(origin: string) {
  const docsRes = await fetch(`${origin}/docs.json`);
  if (!docsRes.ok) throw new Error(`docs.json ${docsRes.status}`);
  const nodes = (await docsRes.json() as {atlasCommit: string, nodes: Record<string, any>;}).nodes;
  return nodes;
}
