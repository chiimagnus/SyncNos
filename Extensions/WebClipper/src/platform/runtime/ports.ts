export function connectPort(name: string): any {
  if (!name) throw new Error('Port name is required');
  return browser.runtime.connect({ name });
}
