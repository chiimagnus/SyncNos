export const ABOUT_YOU_USER_NAME_STORAGE_KEY = 'about_you_user_name';
export const DEFAULT_ABOUT_YOU_USER_NAME = 'You';

export function normalizeUserName(input: unknown): string {
  return String(input == null ? '' : input).trim();
}

export function resolveAboutYouUserName(input: unknown): string {
  return normalizeUserName(input) || DEFAULT_ABOUT_YOU_USER_NAME;
}
