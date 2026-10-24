export interface ServerDisplayEntry {
  id: string;
  name?: string;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Presentation order only; never reorder configured server or selection state. */
export function sortServersForDisplay<T extends ServerDisplayEntry>(servers: readonly T[]): T[] {
  return [...servers].sort((a, b) => {
    const nameOrder = collator.compare(a.name?.trim() || a.id, b.name?.trim() || b.id);
    return nameOrder || collator.compare(a.id, b.id);
  });
}
