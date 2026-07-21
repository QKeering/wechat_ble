import { createRingBleFacade } from '@/sdk/ring-ble';

export const createRingFeature = () => {
  return {
    createBleFacade: createRingBleFacade
  };
};
