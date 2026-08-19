/**
 * Company Name Deduplication Utility
 *
 * Provides normalized, fuzzy matching for company names to prevent
 * duplicate business records from being created.
 *
 * Strategy:
 *  1. Normalize both names (lowercase, strip punctuation, collapse whitespace,
 *     remove common corporate suffixes like "Inc", "LLC", "Ltd" etc.)
 *  2. Compute token-overlap (Jaccard) similarity between the normalized tokens.
 *  3. Fall back to Jaro-Winkler character similarity for short / single-token names.
 *  4. Return a similarity score in [0, 1]; callers decide the threshold.
 */

// ─── Common corporate suffixes to strip ──────────────────────────────────────
const STRIP_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation",
  "co", "company", "plc", "gmbh", "ag", "sa", "bv", "srl", "pty", "pvt",
  "group", "holdings", "enterprises", "solutions", "services", "technologies",
  "tech", "systems", "consulting", "associates", "partners",
]);

// ─── Normalize a company name ─────────────────────────────────────────────────
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    // Remove punctuation except spaces
    .replace(/[^a-z0-9\s]/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize and return an array of meaningful tokens (suffixes stripped). */
export function tokenize(name: string): string[] {
  const normalized = normalizeName(name);
  const tokens = normalized.split(" ").filter(Boolean);
  // Keep non-suffix tokens; if ALL are suffixes, keep all (edge case: "Inc")
  const meaningful = tokens.filter((t) => !STRIP_SUFFIXES.has(t));
  return meaningful.length > 0 ? meaningful : tokens;
}

// ─── Jaccard token similarity ─────────────────────────────────────────────────
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ─── Jaro-Winkler similarity ──────────────────────────────────────────────────
export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  // Winkler prefix boost (max 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

// ─── Combined similarity score ────────────────────────────────────────────────
/**
 * Returns a similarity score in [0, 1] between two company names.
 *
 * Uses:
 *  - Jaccard similarity over meaningful tokens (primary)
 *  - Jaro-Winkler on the normalized full string (secondary, for short names)
 *  - Weighted average: 0.6 * jaccard + 0.4 * jaro-winkler
 */
export function companyNameSimilarity(nameA: string, nameB: string): number {
  const tokensA = tokenize(nameA);
  const tokensB = tokenize(nameB);
  const jaccard = jaccardSimilarity(tokensA, tokensB);

  const normA = normalizeName(nameA);
  const normB = normalizeName(nameB);
  const jw = jaroWinkler(normA, normB);

  return 0.6 * jaccard + 0.4 * jw;
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

export interface DuplicateCandidate {
  id: number;
  company_name: string;
  similarity: number;
}

/**
 * Given a candidate company name and a list of existing businesses,
 * returns businesses whose name is similar enough to be considered a duplicate.
 *
 * @param candidateName - The name to check
 * @param existingBusinesses - List of {id, company_name} from the DB
 * @param threshold - Similarity threshold in [0,1], default 0.75
 */
export function findDuplicateCandidates(
  candidateName: string,
  existingBusinesses: Array<{ id: number; company_name: string | null }>,
  threshold = 0.75
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (const biz of existingBusinesses) {
    if (!biz.company_name) continue;
    const score = companyNameSimilarity(candidateName, biz.company_name);
    if (score >= threshold) {
      candidates.push({
        id: biz.id,
        company_name: biz.company_name,
        similarity: score,
      });
    }
  }

  // Sort by similarity descending
  return candidates.sort((a, b) => b.similarity - a.similarity);
}
