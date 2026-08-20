const paths: Record<string, string> = {
  home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  package:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v9"/>',
  cart:'<path d="M3 4h2l2 11h10l2-7H6"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/>',
  scale:'<path d="M12 3v18M5 6h14M5 6l-3 7h6L5 6Zm14 0-3 7h6l-3-7ZM8 21h8"/>',
  ticket:'<path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V6Z"/><path d="M12 8v8"/>',
  bank:'<path d="m3 9 9-5 9 5M5 10v7m5-7v7m4-7v7m5-7v7M3 20h18"/>',
  sparkles:'<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Zm14-2 .8 2.2 2.2.8-2.2.8L19 18l-.8-2.2L16 15l2.2-.8L19 12Z"/>',
  car:'<path d="m5 16-1-3 2-5h12l2 5-1 3H5Z"/><path d="M7 16v3m10-3v3M4 13h16M8 13h.01M16 13h.01"/>',
  bike:'<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="m6 17 4-8h4l4 8M9 12h7M12 17l-3-5M14 9l-1-2h3"/>',
  chart:'<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
  users:'<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75"/>',
  bag:'<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  crown:'<path d="m3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Z"/><path d="M5 21h14"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5m4-2v6l4 2"/>',
  pulse:'<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',
  reverse:'<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"/>',
  archive:'<path d="M4 7h16v14H4V7Z"/><path d="M3 3h18v4H3V3Zm6 8h6"/>',
  badge:'<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  book:'<path d="M4 5a3 3 0 0 1 3-3h5v19H7a3 3 0 0 0-3 1V5Zm16 0a3 3 0 0 0-3-3h-5v19h5a3 3 0 0 1 3 1V5Z"/>',
  flask:'<path d="M9 3h6m-5 0v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8"/>',
  boxes:'<path d="m7 3 4 2-4 2-4-2 4-2Zm10 0 4 2-4 2-4-2 4-2ZM7 11l4 2-4 2-4-2 4-2Zm10 0 4 2-4 2-4-2 4-2ZM12 18l4 2-4 2-4-2 4-2Z"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  moon:'<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>'
};

export function icon(name: string, className = "size-5"): string {
  return `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.home}</svg>`;
}
