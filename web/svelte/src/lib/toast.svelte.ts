export type Toast = { id: number; message: string };

let nextId = 0;

export const toasts = $state<Toast[]>([]);

/** Show a transient confirmation at the bottom of the window. */
export function toast(message: string, duration = 1800) {
  const id = ++nextId;
  toasts.push({ id, message });
  window.setTimeout(() => {
    const index = toasts.findIndex((candidate) => candidate.id === id);
    if (index !== -1) toasts.splice(index, 1);
  }, duration);
}
