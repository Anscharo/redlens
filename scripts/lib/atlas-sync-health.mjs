// Structural integrity checks for the Atlas worker's SHA-gated fast path.
// A matching sync_state SHA is only a pointer: it is not proof that the tables
// behind that pointer are populated. Keep this check independent of build
// artifacts so it can detect and repair a partially restored/corrupted DB.

function count(row, key) {
  const value = Number(row?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function assessStructuralSnapshot(snapshot) {
  const reasons = [];
  if (!snapshot.syncSha) reasons.push("sync_state has no atlas SHA");
  if (snapshot.currentDocs === 0) reasons.push("no current atlas_doc_meta rows");
  if (snapshot.totalDocs !== snapshot.currentDocs) {
    reasons.push(`${snapshot.totalDocs - snapshot.currentDocs} atlas_doc_meta row(s) carry another SHA`);
  }
  if (snapshot.docsWithAddressRefs > 0 && snapshot.currentAddresses === 0) {
    reasons.push(`${snapshot.docsWithAddressRefs} current document(s) reference addresses but atlas_addresses is empty`);
  }
  if (snapshot.totalAddresses !== snapshot.currentAddresses) {
    reasons.push(`${snapshot.totalAddresses - snapshot.currentAddresses} atlas_addresses row(s) carry another SHA`);
  }
  return { ...snapshot, healthy: reasons.length === 0, reasons };
}

export async function inspectStructuralSnapshot(db, syncSha) {
  if (!syncSha) {
    return assessStructuralSnapshot({
      syncSha: null,
      totalDocs: 0,
      currentDocs: 0,
      docsWithAddressRefs: 0,
      totalAddresses: 0,
      currentAddresses: 0,
    });
  }

  try {
    const [docRows, addressRows] = await Promise.all([
      db`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE atlas_sha = ${syncSha})::int AS current,
          COUNT(*) FILTER (
            WHERE atlas_sha = ${syncSha}
              AND jsonb_array_length(COALESCE(address_refs, '[]'::jsonb)) > 0
          )::int AS with_address_refs
        FROM atlas_doc_meta
      `,
      db`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE atlas_sha = ${syncSha})::int AS current
        FROM atlas_addresses
      `,
    ]);
    const docs = docRows[0];
    const addresses = addressRows[0];
    return assessStructuralSnapshot({
      syncSha,
      totalDocs: count(docs, "total"),
      currentDocs: count(docs, "current"),
      docsWithAddressRefs: count(docs, "with_address_refs"),
      totalAddresses: count(addresses, "total"),
      currentAddresses: count(addresses, "current"),
    });
  } catch (error) {
    return {
      syncSha,
      totalDocs: 0,
      currentDocs: 0,
      docsWithAddressRefs: 0,
      totalAddresses: 0,
      currentAddresses: 0,
      healthy: false,
      reasons: [`integrity query failed: ${error?.message ?? error}`],
    };
  }
}
