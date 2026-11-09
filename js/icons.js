// Thin line icons (24×24, stroke = currentColor) – replace emojis so the chat stays on-brand.
const P = {
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  camera: '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  beard: '<path d="M5 6c0 7 2 13 7 13s7-6 7-13"/><path d="M8 13c1.5-1 6.5-1 8 0M9 16c1 .8 5 .8 6 0"/>',
  razor: '<rect x="5" y="3" width="14" height="5" rx="1"/><path d="M7 5.5h10M11 8l-1 13h4l-1-13"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  basket: '<path d="M5 8h14l-1.5 11h-11z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  check: '<path d="M5 12l4.5 4.5L19 7"/>',
  gift: '<rect x="4" y="9" width="16" height="11"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9c2 0 6 1 6-1.5S14 5 12 9"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14"/><path d="M3 6l9 7 9-7"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M6 12h12M12 6v12"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  thumbUp: '<path d="M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"/>',
  thumbDown: '<path d="M7 13V4H4v9zM7 13l4 8c1.5 0 2.5-1 2.5-2.5V15h5a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 17.3 4H7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
};
export function icon(name, cls = "ico") {
  const d = P[name];
  return d ? `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>` : "";
}
export const ICONS = Object.keys(P);
