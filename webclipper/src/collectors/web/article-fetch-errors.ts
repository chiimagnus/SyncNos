export const DISCOURSE_OP_MISSING_WARNING_FLAG = 'discourse_op_missing_on_page';
export const DISCOURSE_OP_NOT_FOUND_ERROR = 'Discourse OP not found';

export function isDiscourseOpNotFoundErrorMessage(raw: unknown): boolean {
  return String(raw || '').trim().toLowerCase() === DISCOURSE_OP_NOT_FOUND_ERROR.toLowerCase();
}
