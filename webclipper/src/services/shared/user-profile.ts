export const ABOUT_YOU_USER_NAME_STORAGE_KEY = 'about_you_user_name';

export function normalizeUserName(input: unknown): string {
  const text = String(input == null ? '' : input).trim();
  return text;
}

