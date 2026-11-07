const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Item do submenu branco: ativo na própria tela, se `nested` nas telas internas, e nos caminhos extras de `also`. */
export function isAreaItemActive(item: { to: string; nested?: boolean; also?: readonly string[] }, path: string) {
  const p = normalize(path);
  return p === item.to || (item.nested === true && p.startsWith(`${item.to}/`)) || (item.also ?? []).includes(p);
}
