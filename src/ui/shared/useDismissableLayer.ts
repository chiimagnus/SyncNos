import { useEffect, useRef, type RefObject } from 'react';

export type UseDismissableLayerOptions = {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  insideRef?: RefObject<HTMLElement | null>;
  onDismiss: () => void;
};

export function useDismissableLayer(options: UseDismissableLayerOptions) {
  const { open, containerRef, insideRef, onDismiss } = options;
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const container = containerRef.current;
      if (!target || !container) {
        onDismissRef.current();
        return;
      }
      if (!container.contains(target) && !insideRef?.current?.contains(target)) onDismissRef.current();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismissRef.current();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, false);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, false);
    };
  }, [open, containerRef, insideRef]);
}
