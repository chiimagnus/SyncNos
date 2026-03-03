import { createBackgroundServices } from './background-services.ts';

export function startBackgroundBootstrap() {
  const services = createBackgroundServices();
  try {
    services.backgroundInpageWebVisibility?.start?.();
  } catch (_e) {
    // ignore
  }

  return services;
}
