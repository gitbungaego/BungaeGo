// Event search normalization. Kept separate from the DB query so the token
// logic is unit-testable without a database.

/**
 * Normalizes a raw search box value into lowercased tokens:
 * lowercase, trim, collapse internal whitespace, then split on spaces.
 * Empty input (or all-whitespace) yields an empty array — the caller treats
 * that as "no search filter".
 *
 * Lowercasing here plus LOWER() on the DB column makes matching
 * case-insensitive even though the event columns use a binary (utf8mb4_bin)
 * collation. Korean has no case, so this is a no-op for Hangul but still lets
 * an alias like "코르티스" match the query "코르티스".
 */
export function normalizeSearchTerm(term: string): string[] {
  return term
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

// LIKE escape character. Deliberately not backslash — MySQL/TiDB already treat
// backslash as a string escape, so a literal `escape '\'` clause is a parse
// error. "!" needs no doubling inside a SQL string literal.
export const LIKE_ESCAPE_CHAR = "!";

/**
 * Escapes the SQL LIKE metacharacters (%, _, and the escape char itself) in a
 * token so a user typing "50%" searches for a literal "50%". Pair with an
 * explicit `ESCAPE '!'` clause in the LIKE.
 */
export function escapeLikePattern(token: string): string {
  return token.replace(/[!%_]/g, (c) => `${LIKE_ESCAPE_CHAR}${c}`);
}
