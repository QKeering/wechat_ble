import { onHide, onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { useRingBusinessController } from '@/composables/useRingBusinessController';

type RingBusinessController = ReturnType<typeof useRingBusinessController>;

export const ensureRingBusinessPageReady = async (ring: RingBusinessController = useRingBusinessController()) => {
  ring.resumeBusinessAutoRefresh();

  if (ring.isScanning.value) return false;

  // Non-home pages only keep the BLE channel available.
  // History sync, upload and final "today data" refresh are owned by the home/global session.
  const restored = await ring.restoreLastBusinessDevice({ refreshAfterRestore: false });
  return restored;
};

export const registerRingHealthPullDownRefresh = () => {
  const ring = useRingBusinessController();

  onShow(() => {
    void ensureRingBusinessPageReady(ring);
  });

  onHide(() => {
    ring.pauseBusinessAutoRefresh();
  });

  onPullDownRefresh(async () => {
    try {
      await ensureRingBusinessPageReady(ring);
    } finally {
      uni.stopPullDownRefresh();
    }
  });
};
