import { ProvenanceTag } from "../gen/nebula/core/v1/run_pb";

const TAGS: Partial<Record<ProvenanceTag, { text: string; title: string }>> = {
  [ProvenanceTag.REBUILT]: {
    text: "rebuilt",
    title: "Re-executed on a newer build (D62)",
  },
  [ProvenanceTag.MIXED_BUILDS]: {
    text: "mixed builds",
    title: "Resumed across builds (D130)",
  },
  [ProvenanceTag.NOT_REPRODUCIBLE_HERE]: {
    text: "viewable, not reproducible here",
    title:
      "Imported with a build that does not match this installation (D100, D149)",
  },
};

export function ProvenanceTags({ tags }: { tags: readonly ProvenanceTag[] }) {
  const shown = tags.flatMap((tag) => {
    const info = TAGS[tag];
    return info ? [{ tag, ...info }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <span className="tags">
      {shown.map(({ tag, text, title }) => (
        <span key={tag} className="badge badge-info" title={title}>
          {text}
        </span>
      ))}
    </span>
  );
}
