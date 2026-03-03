import { createRuntimeClient } from '../platform/runtime/client';
import { isInvalidContextError } from '../platform/runtime/runtime';

const runtimeClientApi = {
  createRuntimeClient,
  isInvalidContextError,
};

export { createRuntimeClient, isInvalidContextError };
export default runtimeClientApi;
