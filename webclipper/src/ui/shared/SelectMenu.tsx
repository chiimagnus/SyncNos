import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { buttonMenuItemClassName, buttonTintClassName, menuChevronClassName } from '@ui/shared/button-styles';
import { MenuPopover } from '@ui/shared/MenuPopover';

export type SelectMenuOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectMenuProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: Array<SelectMenuOption<T>>;
  disabled?: boolean;
  ariaLabel: string;
  minWidth?: number;
  maxHeight?: number;
  adaptiveMaxHeight?: boolean;
  className?: string;
  buttonClassName?: string;
  triggerLabelClassName?: string;
  chevronOverlay?: boolean;
  buttonId?: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
};

function clampIndex(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function findFirstEnabledIndex<T extends string>(options: Array<SelectMenuOption<T>>) {
  for (let i = 0; i < options.length; i += 1) {
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

function findLastEnabledIndex<T extends string>(options: Array<SelectMenuOption<T>>) {
  for (let i = options.length - 1; i >= 0; i -= 1) {
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

function moveEnabledIndex<T extends string>(options: Array<SelectMenuOption<T>>, from: number, delta: -1 | 1) {
  if (!options.length) return -1;
  let i = clampIndex(from, 0, options.length - 1);
  for (let step = 0; step < options.length; step += 1) {
    i += delta;
    if (i < 0) i = options.length - 1;
    if (i >= options.length) i = 0;
    if (!options[i]?.disabled) return i;
  }
  return from;
}

function findNearestClippingRect(el: HTMLElement | null): DOMRect | null {
  if (!el) return null;
  let current = el.parentElement;
  while (current) {
    try {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY || style.overflow;
      if (overflowY && overflowY !== 'visible') {
        if (typeof current.getBoundingClientRect === 'function') {
          const rect = current.getBoundingClientRect();
          if (rect && Number.isFinite(rect.height) && rect.height > 0) return rect;
        }
      }
    } catch {
      // ignore
    }
    current = current.parentElement;
  }
  return null;
}

export function SelectMenu<T extends string>(props: SelectMenuProps<T>) {
  const {
    value,
    onChange,
    options,
    disabled,
    ariaLabel,
    minWidth,
    maxHeight,
    adaptiveMaxHeight = false,
    className,
    buttonClassName,
    triggerLabelClassName,
    chevronOverlay = false,
    buttonId,
    side = 'bottom',
    align = 'end',
  } = props;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const resolved = useMemo(() => {
    const safeOptions = Array.isArray(options) ? options : [];
    const selectedIndex = safeOptions.findIndex((opt) => opt?.value === value);
    const selected = selectedIndex >= 0 ? safeOptions[selectedIndex] : undefined;
    return { safeOptions, selectedIndex, selected };
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const nextIndex = (() => {
      const selectedIndex = resolved.selectedIndex;
      if (selectedIndex >= 0 && !resolved.safeOptions[selectedIndex]?.disabled) return selectedIndex;
      return findFirstEnabledIndex(resolved.safeOptions);
    })();
    setActiveIndex(nextIndex);
  }, [open, resolved.safeOptions, resolved.selectedIndex]);

  useEffect(() => {
    if (!open) return;
    if (activeIndex < 0) return;
    const el = optionRefs.current[activeIndex];
    if (!el) return;
    const raf = window.requestAnimationFrame(() => el.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    return () => {
      optionRefs.current = [];
    };
  }, [open]);

  const triggerLabel = resolved.selected?.label ?? resolved.safeOptions[0]?.label ?? '';
  const menuItemButtonClassName = buttonMenuItemClassName();
  const triggerButtonClassName = buttonClassName || buttonTintClassName();
  const chevronClassName = menuChevronClassName();
  const resolvedTriggerLabelClassName = triggerLabelClassName || 'tw-min-w-0 tw-flex-1 tw-truncate tw-text-left';
  const resolvedChevronClassName = chevronOverlay
    ? [
        'tw-absolute tw-right-2 tw-top-1/2 -tw-translate-y-1/2 tw-bg-transparent tw-pointer-events-none',
        chevronClassName,
      ].join(' ')
    : ['tw-ml-1', chevronClassName].join(' ');
  const resolvedTriggerLayoutClassName = chevronOverlay
    ? 'tw-relative tw-inline-flex tw-items-center'
    : 'tw-inline-flex tw-items-center tw-justify-between tw-gap-2';

  const resolvedPanelMaxHeight = useMemo(() => {
    if (!adaptiveMaxHeight) return maxHeight;
    if (!open) return maxHeight;
    const el = triggerRef.current;
    if (!el || typeof el.getBoundingClientRect !== 'function') return maxHeight;

    const rect = el.getBoundingClientRect();
    const gap = 8;
    const margin = 14;
    const clipRect = findNearestClippingRect(el);

    const available =
      side === 'top'
        ? rect.top - (clipRect?.top ?? 0) - gap - margin
        : (clipRect?.bottom ?? window.innerHeight) - rect.bottom - gap - margin;

    const next = Math.floor(Math.max(80, Number.isFinite(available) ? available : 160));
    return next;
  }, [adaptiveMaxHeight, maxHeight, open, side]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    const el = triggerRef.current;
    if (el) {
      window.requestAnimationFrame(() => el.focus());
    }
  };

  const pickIndex = (index: number) => {
    const opt = resolved.safeOptions[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    closeAndRestoreFocus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      const i = findFirstEnabledIndex(resolved.safeOptions);
      setActiveIndex(i);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const i = findLastEnabledIndex(resolved.safeOptions);
      setActiveIndex(i);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => moveEnabledIndex(resolved.safeOptions, current, 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => moveEnabledIndex(resolved.safeOptions, current, -1));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeIndex >= 0) pickIndex(activeIndex);
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setOpen(true);
    if (event.key === 'ArrowUp') {
      const preferred =
        resolved.selectedIndex >= 0 && !resolved.safeOptions[resolved.selectedIndex]?.disabled
          ? resolved.selectedIndex
          : -1;
      setActiveIndex(preferred >= 0 ? preferred : findLastEnabledIndex(resolved.safeOptions));
    } else {
      const preferred =
        resolved.selectedIndex >= 0 && !resolved.safeOptions[resolved.selectedIndex]?.disabled
          ? resolved.selectedIndex
          : -1;
      setActiveIndex(preferred >= 0 ? preferred : findFirstEnabledIndex(resolved.safeOptions));
    }
  };

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      ariaLabel={ariaLabel}
      side={side}
      align={align}
      panelMinWidth={minWidth}
      panelMaxHeight={resolvedPanelMaxHeight}
      className={className}
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          ref={triggerRef}
          id={buttonId}
          className={[resolvedTriggerLayoutClassName, triggerButtonClassName].join(' ')}
          aria-label={ariaLabel}
          onKeyDown={onTriggerKeyDown}
        >
          <span className={resolvedTriggerLabelClassName}>{triggerLabel}</span>
          <span className={resolvedChevronClassName} aria-hidden="true">
            ▾
          </span>
        </button>
      )}
    >
      <div onKeyDown={onMenuKeyDown}>
        {resolved.safeOptions.map((opt, index) => {
          const selected = opt.value === value;
          const isActive = index === activeIndex;
          return (
            <button
              key={String(opt.value)}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={selected ? 'true' : 'false'}
              disabled={!!opt.disabled}
              tabIndex={isActive ? 0 : -1}
              className={menuItemButtonClassName}
              onClick={() => pickIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
            >
              <span className="tw-inline-flex tw-min-w-0 tw-items-center tw-gap-2">
                <span
                  className="tw-w-3 tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                  aria-hidden="true"
                >
                  {selected ? '✓' : ''}
                </span>
                <span className="tw-min-w-0 tw-flex-1 tw-truncate">{opt.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </MenuPopover>
  );
}
