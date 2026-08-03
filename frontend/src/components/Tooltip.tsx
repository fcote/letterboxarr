import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Distance between the trigger and the bubble
const GAP = 8;
// Matches max-w-sm below, used to keep the bubble inside the viewport without
// having to measure it and lay out twice
const MAX_WIDTH = 384;

interface TooltipProps {
  // One line each, in order; the first is the heading. Empty entries are dropped,
  // and a tooltip with nothing to say renders its children untouched.
  lines: (string | null | undefined | false)[];
  children: React.ReactNode;
  // Classes for the trigger, which is the element the bubble is measured against
  className?: string;
  // Whether the trigger itself takes a tab stop. Off for things that appear dozens
  // of times in a list, and for wrapped buttons which are already focusable: the
  // bubble still shows on focus either way, since focus events bubble out of the
  // children.
  focusable?: boolean;
}

interface Placement {
  left: number;
  top: number;
  below: boolean;
}

// Shown the moment the pointer arrives: no delay, no fade. A hover that has to be
// held is worse than no tooltip when there are sixty rows to skim.
const Tooltip: React.FC<TooltipProps> = ({
  lines, children, className, focusable = true
}) => {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const content = lines.filter((line): line is string => Boolean(line));

  const show = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;

    // Above unless the trigger is too near the top of the window for it to fit
    const below = box.top < 110;
    setPlacement({
      left: Math.max(8, Math.min(box.left, window.innerWidth - MAX_WIDTH - 8)),
      top: below ? box.bottom + GAP : box.top - GAP,
      below
    });
  }, []);

  const hide = useCallback(() => setPlacement(null), []);

  // The bubble is placed against where the trigger was, so anything that moves it
  // has to dismiss it rather than leave it stranded mid-page
  useEffect(() => {
    if (!placement) return;

    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [placement, hide]);

  if (content.length === 0) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={trigger}
        className={className}
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={placement ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {placement && createPortal(
        <div
          id={id}
          role="tooltip"
          // Fixed and portalled to the body: the list sits in a card with
          // overflow hidden, which would otherwise cut the bubble off.
          // pointer-events-none keeps it from stealing the hover it came from.
          className="pointer-events-none fixed z-50 max-w-sm rounded-md border border-dark-border
                     bg-dark-bg-secondary px-3 py-2 text-xs shadow-xl"
          style={{
            left: placement.left,
            top: placement.top,
            transform: placement.below ? undefined : 'translateY(-100%)'
          }}
        >
          {content.map((line, index) => (
            <p
              key={index}
              className={index === 0
                ? 'font-medium text-dark-text-primary'
                : 'mt-1 text-dark-text-muted'}
            >
              {line}
            </p>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

export default Tooltip;
