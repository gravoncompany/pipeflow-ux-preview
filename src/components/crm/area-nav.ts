const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Item do submenu branco: ativo na própria tela e, se `nested`, nas telas internas dela. */
export function isAreaItemActive(item: { to: string; nested?: boolean }, path: string) {
  const p = normalize(path);
  return p === item.to || (item.nested === true && p.startsWith(`${item.to}/`));
}
