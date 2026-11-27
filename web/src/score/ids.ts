export type IdGen = () => string;

function randomChars(n: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Fresh random identifier, e.g. `n-k3j9x0qa`. Matches the id pattern of the schema. */
export function newId(prefix = 'n'): string {
  return `${prefix}-${randomChars(8)}`;
}

/**
 * Deterministic id sequence from a seed. Commands keep their seed so that `apply` called twice
 * (redo) produces exactly the same ids.
 */
export function idGen(seed: string): IdGen {
  let n = 0;
  return () => `${seed}.${(n++).toString(36)}`;
}
