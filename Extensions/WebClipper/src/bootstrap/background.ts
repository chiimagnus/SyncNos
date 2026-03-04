import { createBackgroundServices } from './background-services.ts';

export function startBackgroundBootstrap() {
  const services = createBackgroundServices();
  return services;
}
