export const TWO_STEP_CONFIRM_TIMEOUT_MS = 2500;

export type TwoStepConfirmController<T> = {
  getArmedKey: () => T | null;
  isArmed: (key: T) => boolean;
  arm: (key: T) => void;
  clear: () => void;
  dispose: () => void;
};

export function createTwoStepConfirmController<T>(input?: {
  timeoutMs?: number;
  onChange?: () => void;
}): TwoStepConfirmController<T> {
  const timeoutMs = Math.max(1, Number(input?.timeoutMs ?? TWO_STEP_CONFIRM_TIMEOUT_MS) || TWO_STEP_CONFIRM_TIMEOUT_MS);
  const onChange = input?.onChange;

  let armedKey: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const notify = () => {
    try {
      onChange?.();
    } catch (_e) {
      // ignore
    }
  };

  const clearTimer = () => {
    if (timer == null) return;
    try {
      clearTimeout(timer);
    } catch (_e) {
      // ignore
    }
    timer = null;
  };

  const clear = () => {
    clearTimer();
    if (armedKey == null) return;
    armedKey = null;
    notify();
  };

  const arm = (key: T) => {
    clearTimer();
    const changed = !(armedKey != null && Object.is(armedKey, key));
    armedKey = key;
    try {
      timer = setTimeout(() => {
        timer = null;
        if (armedKey == null) return;
        armedKey = null;
        notify();
      }, timeoutMs);
    } catch (_e) {
      // ignore
    }
    if (changed) notify();
  };

  const isArmed = (key: T) => armedKey != null && Object.is(armedKey, key);

  const getArmedKey = () => armedKey;

  const dispose = () => {
    clearTimer();
    armedKey = null;
  };

  return { getArmedKey, isArmed, arm, clear, dispose };
}
