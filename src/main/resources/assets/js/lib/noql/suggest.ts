function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = new Array(rows * cols);

  for (let i = 0; i < rows; i++) dp[i * cols] = i;
  for (let j = 0; j < cols; j++) dp[j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(
        dp[(i - 1) * cols + j] + 1,
        dp[i * cols + (j - 1)] + 1,
        dp[(i - 1) * cols + (j - 1)] + cost,
      );
    }
  }

  return dp[rows * cols - 1];
}

export function closestName(input: string, candidates: string[]): string | undefined {
  if (input.length === 0 || candidates.length === 0) return undefined;

  const normalized = input.toLowerCase();
  const cutoff = Math.max(1, Math.min(2, Math.ceil(input.length / 3)));

  let bestName: string | undefined;
  let bestDistance = cutoff + 1;

  for (const candidate of candidates) {
    const distance = levenshtein(normalized, candidate.toLowerCase());
    if (distance === 0) return candidate;
    if (distance <= cutoff && distance < bestDistance) {
      bestName = candidate;
      bestDistance = distance;
    }
  }

  return bestName;
}
