import { onHide, onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { useRingBusinessController } from '@/composables/useRingBusinessController';

type RingBusinessController = ReturnType<typeof useRingBusinessController>;

export const ensureRingBusinessPageReady = async (ring: RingBusinessController = useRingBusinessController()) => {
  ring.resumeBusinessAutoRefresh();

  if (ring.isScanning.value) return false;

  const restored = await ring.restoreLastBusinessDevice();
  if (!restored && !ring.isScanning.value) {
    await ring.scanForBusinessDevices();
    return false;
  }

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
      if (ring.isReady.value) {
        await ring.refreshBusinessData();
      } else {
        await ensureRingBusinessPageReady(ring);
      }
    } finally {
      uni.stopPullDownRefresh();
    }
  });
};
