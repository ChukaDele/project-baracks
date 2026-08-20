import { AsyncLocalStorage } from 'node:async_hooks';

const routedExecutionStorage = new AsyncLocalStorage();

export function withRoutedExecutionContext(context, callback) {
  return routedExecutionStorage.run(Object.freeze({ ...context }), callback);
}

export function routedExecutionContext() {
  const context = routedExecutionStorage.getStore();
  if (!context) {
    throw new Error('major-workstation: no routed execution context is active');
  }
  return context;
}
