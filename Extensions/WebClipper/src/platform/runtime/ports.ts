export function connectPort(name: string): any {
  if (!name) throw new Error('Port name is required');
  const anyGlobal = globalThis as any;
  const runtime = anyGlobal.browser?.runtime ?? anyGlobal.chrome?.runtime;
  if (!runtime?.connect) throw new Error('runtime.connect unavailable');
  return runtime.connect({ name });
}
