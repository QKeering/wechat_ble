/**
 * Race a promise against a timeout without cancelling the underlying work.
 *
 * BLE calls in this project often have no JS-level timeout (especially the
 * legacy adapter), and some operations are worth letting finish in the
 * background even after the UI stops waiting. Use this for "how long the UI is
 * willing to wait", not for resource cleanup.
 */
export const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, timeoutMs));
    (timer as any).unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};
