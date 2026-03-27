export function moveMentionHighlightIndex(input: {
  current: number;
  count: number;
  key: string;
}): number {
  const count = Math.max(0, Math.floor(Number(input.count) || 0));
  if (count <= 0) return 0;

  const current = Math.max(0, Math.floor(Number(input.current) || 0));
  const key = String(input.key || '');

  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  return Math.min(current, count - 1);
}

