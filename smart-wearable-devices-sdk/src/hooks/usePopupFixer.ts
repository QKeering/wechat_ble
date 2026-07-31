import { ref, computed } from 'vue';

function usePopupFixer() {
  const isPopupActive = ref(false);

  const fixedPageStyle = computed(() => {
    return `overflow: ${isPopupActive.value ? 'hidden' : 'visible'}`;
  });

  return {
    isPopupActive,
    fixedPageStyle
  };
}

export { usePopupFixer };
