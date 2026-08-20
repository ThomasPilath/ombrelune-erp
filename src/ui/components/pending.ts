export async function withPending<T>(control: HTMLButtonElement, pendingLabel: string, action: () => Promise<T>): Promise<T> {
  if (control.disabled || control.getAttribute("aria-busy") === "true") throw new Error("Action déjà en cours");
  const label = control.textContent ?? "";
  control.disabled = true;
  control.setAttribute("aria-busy", "true");
  control.textContent = pendingLabel;
  try { return await action(); }
  finally {
    if (control.isConnected) {
      control.disabled = false;
      control.removeAttribute("aria-busy");
      control.textContent = label;
    }
  }
}
