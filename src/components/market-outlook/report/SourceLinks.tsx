// Renders the real, run-specific list of sources that fed a page's content —
// replaces the old hand-authored (and, on audit, inaccurate/fabricated)
// per-page sourceLine strings. Entries with a real URL are clickable; search-
// derived sources only ever carry a pseudo `search:...` url and render as
// plain text rather than a dead link.
export function SourceLinks({
  sources,
  fallback,
  forPdf,
}: {
  sources: { name: string; url: string | null }[];
  fallback: string;
  /** True for the PDF-export render — a link's visible text becomes its
   *  actual URL (no interactive click in a static document, so spell it
   *  out) instead of the friendly name shown on screen. */
  forPdf?: boolean;
}) {
  if (sources.length === 0) return <>{fallback}</>;
  return (
    <>
      Source:{" "}
      {sources.map((s, i) => (
        <span key={s.name}>
          {i > 0 && ", "}
          {s.url ? (
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {forPdf ? s.url : s.name}
            </a>
          ) : (
            s.name
          )}
        </span>
      ))}
    </>
  );
}
