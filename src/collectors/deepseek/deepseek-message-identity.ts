export const DEEPSEEK_MESSAGE_ID_ATTRIBUTE = 'data-syncnos-deepseek-message-id';

export function stampDeepseekMessageIdentities(root: Element | null, sessionId: string): void {
  if (!root || !sessionId) return;
  for (const item of Array.from(root.querySelectorAll('[data-virtual-list-item-key]'))) {
    const renderKey = Number(item.getAttribute('data-virtual-list-item-key'));
    if (!Number.isSafeInteger(renderKey) || renderKey >= 0) continue;
    const fiberKey = Object.keys(item).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (item as any)[fiberKey] : null;
    let messageId = 0;
    while (fiber && !messageId) {
      const candidates = [fiber.memoizedProps, fiber.alternate?.memoizedProps];
      for (const props of candidates) {
        if (props?.sessionId === sessionId && Number.isSafeInteger(props.messageId) && props.messageId > 0) {
          messageId = props.messageId;
          break;
        }
      }
      if (candidates.some((props) => props && 'sessionId' in props && 'messageId' in props)) break;
      fiber = fiber.return;
    }
    if (messageId && item.getAttribute(DEEPSEEK_MESSAGE_ID_ATTRIBUTE) !== String(messageId)) {
      item.setAttribute(DEEPSEEK_MESSAGE_ID_ATTRIBUTE, String(messageId));
    } else if (!messageId && item.hasAttribute(DEEPSEEK_MESSAGE_ID_ATTRIBUTE)) {
      item.removeAttribute(DEEPSEEK_MESSAGE_ID_ATTRIBUTE);
    }
  }
}
