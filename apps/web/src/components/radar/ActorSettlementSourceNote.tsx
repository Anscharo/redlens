// Where the settlement figures come from, and how they differ from the Atlas's Net Revenue.
export function SourceNote({
  workbook,
  month,
  forumUrl,
}: {
  workbook: string;
  month: string;
  forumUrl: string | undefined;
}) {
  return (
    <p className="text-xs mb-4" style={{ color: "var(--tan-3)" }}>
      From Soter Labs' published Monthly Settlement Cycle workbooks — OEA
      calculations, not the on-chain GovOps spell and not Sky Atlas figures.
      “To Sky” is what this Prime owed Sky, not the Protocol’s Net Revenue,
      which the Atlas defines as income minus expenses (A.2.3.1.2.1.1).{" "}
      <a href={workbook} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
        {month} source
      </a>
      {forumUrl && (
        <>
          {" · "}
          <a href={forumUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            Sky Forum
          </a>
        </>
      )}
    </p>
  );
}
