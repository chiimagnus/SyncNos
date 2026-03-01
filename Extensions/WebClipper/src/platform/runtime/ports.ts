export function connectPort(name: string): browser.runtime.Port {
  if (!name) throw new Error('Port name is required');
  return browser.runtime.connect({ name });
}

