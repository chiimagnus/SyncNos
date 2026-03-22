import { connectPort as platformConnectPort } from '@platform/runtime/ports';

export const ports = {
  connect: platformConnectPort,
};

export { platformConnectPort as connectPort };

