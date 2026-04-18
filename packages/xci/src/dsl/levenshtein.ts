// D-12 step 4 support: "did you mean" suggestions for unknown alias refs.
// Threshold ceil(target.length / 3) matches git's suggestion heuristic.

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    const row: number[] = [];
    for (let j = 0; j <= n; j++) {
      row.push(i === 0 ? j : j === 0 ? i : 0);
    }
    dp.push(row);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }
  return dp[m]![n]!;
}

export function suggest(target: string, known: readonly string[]): string[] {
  const threshold = Math.max(1, Math.ceil(target.length / 3));
  return known
    .map((s) => ({ s, d: levenshtein(target, s) }))
    .filter(({ d }) => d <= threshold)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ s }) => s);
}
