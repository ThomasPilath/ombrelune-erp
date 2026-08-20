const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function keepFocusInside(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const controls = [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(control => !control.hidden && control.getClientRects().length > 0);
  if (!controls.length) { event.preventDefault(); container.focus(); return; }
  const first = controls[0]!; const last = controls.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function lockDocumentScroll(lock: boolean): void {
  document.documentElement.classList.toggle("overflow-hidden", lock);
}
