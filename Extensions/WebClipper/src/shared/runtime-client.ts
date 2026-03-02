import runtimeContext from '../runtime-context.ts';
import { createRuntimeClient } from '../platform/runtime/client';
import { isInvalidContextError } from '../platform/runtime/runtime';

const runtimeClientApi = {
  createRuntimeClient,
  isInvalidContextError,
};

runtimeContext.runtimeClient = runtimeClientApi;

export { createRuntimeClient, isInvalidContextError };
export default runtimeClientApi;
