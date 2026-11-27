/**
 * Command search: accent- and case-insensitive, word-based with a bounded subsequence fallback
 * ("rst" finds "rest"). Pure functions, no React.
 */

/** Lower case, accents removed ("Bémol" -> "bemol"), apostrophes as spaces. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SearchEntry {
  id: string;
  /** Normalized texts to match: the label in every language, the group names. */
  texts: readonly string[];
  /** Weight of each text (labels 1, group names lower). */
  weights?: readonly number[];
}

/** Score of one query word against one normalized text; 0 means no match. */
export function scoreToken(token: string, text: string): number {
  if (!token) return 0;
  const at = text.indexOf(token);
  if (at >= 0) {
    const wordStart = at === 0 || text[at - 1] === ' ';
    // Shorter texts first: the query covers more of them.
    const tight = Math.min(text.length, 60) * 0.1;
    if (wordStart) return (at === 0 ? 120 : 100) - tight;
    return 50 - tight;
  }
  // Subsequence: only for words of 3+ letters and with a tight span, so "rst" finds "rest" but
  // "rest" does not find "Raise by a semitone".
  if (token.length < 3) return 0;
  let from = 0;
  let first = -1;
  let last = -1;
  for (const ch of token) {
    const i = text.indexOf(ch, from);
    if (i < 0) return 0;
    if (first < 0) first = i;
    last = i;
    from = i + 1;
  }
  const span = last - first + 1;
  if (span > token.length + 1) return 0;
  return 20 - (span - token.length) * 5;
}

/** Score of a whole query (all words must match); 0 means the entry is filtered out. */
export function scoreEntry(tokens: readonly string[], entry: SearchEntry): number {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    entry.texts.forEach((text, i) => {
      const s = scoreToken(token, text) * (entry.weights?.[i] ?? 1);
      if (s > best) best = s;
    });
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * Ids of the entries matching `query`, best first. Ties keep the order of `recent` (most recent
 * first), then the original order. An empty query returns every entry: recent ones first, in
 * recency order, then the rest in their original order.
 */
export function rank(
  entries: readonly SearchEntry[],
  query: string,
  recent: readonly string[] = [],
): string[] {
  const tokens = normalize(query).split(' ').filter(Boolean);
  const recency = new Map(recent.map((id, i) => [id, i]));
  const rec = (id: string) => recency.get(id) ?? Number.POSITIVE_INFINITY;
  const scored: { id: string; score: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const score = tokens.length ? scoreEntry(tokens, entry) : 1;
    if (score > 0) scored.push({ id: entry.id, score, order });
  });
  scored.sort((a, b) => b.score - a.score || rec(a.id) - rec(b.id) || a.order - b.order);
  return scored.map((s) => s.id);
}
