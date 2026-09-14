export function commentAuthorLabel(name: string | null | undefined): string {
  return String(name || 'You').trim() || 'You';
}

export function commentAvatarLabel(name: string | null | undefined): string {
  return Array.from(commentAuthorLabel(name))[0]?.toUpperCase() || 'Y';
}

export function formatCommentTime(ts: number | null | undefined): string {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}
