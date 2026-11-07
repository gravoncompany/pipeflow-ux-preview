type G = { jid: string; name: string };

/** Filters groups by name, internal tag ("" = untagged, null = any) and selection; result is alphabetical. */
export function filterGroups<X extends G>(groups: X[], o: { q: string; tag: string | null; onlySelected: boolean; selected: Set<string>; byGroup: Record<string, string[]> }): X[] {
  const term = o.q.trim().toLocaleLowerCase("pt-BR");
  return groups.filter(g =>
    (!term || g.name.toLocaleLowerCase("pt-BR").includes(term)) &&
    (o.tag === null || (o.tag === "" ? !(o.byGroup[g.jid]?.length) : (o.byGroup[g.jid] ?? []).includes(o.tag))) &&
    (!o.onlySelected || o.selected.has(g.jid)),
  ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
