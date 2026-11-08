import {useRef, useState, type PointerEvent, type ReactNode} from 'react';

const reveal = 88;
const threshold = 64;

type Props = {
  label: string;
  onClear: () => void;
  children: ReactNode;
};

/** Swipe left to reveal Clear; crossing the threshold clears immediately. */
export function SwipeToClear({label, onClear, children}: Props) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const axis = useRef<'x' | 'y' | null>(null);
  const offsetRef = useRef(0);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const setSwipe = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };

  const endGesture = () => {
    const swiped = axis.current === 'x' && Math.abs(offsetRef.current) > 8;
    const shouldClear = offsetRef.current <= -threshold;
    const shouldReveal = offsetRef.current <= -40;
    startX.current = null;
    startY.current = null;
    axis.current = null;
    setDragging(false);
    if (swiped) suppressClick.current = true;
    if (shouldClear) {
      setSwipe(-reveal);
      onClear();
      return;
    }
    setSwipe(shouldReveal ? -reveal : 0);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    startX.current = event.clientX;
    startY.current = event.clientY;
    axis.current = null;
    suppressClick.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startX.current == null || startY.current == null) return;
    const dx = event.clientX - startX.current;
    const dy = event.clientY - startY.current;
    if (!axis.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis.current === 'y') return;
    }
    if (axis.current !== 'x') return;
    event.preventDefault();
    setSwipe(Math.max(-reveal, Math.min(0, dx)));
  };

  const onPointerUp = () => {
    if (startX.current == null) return;
    endGesture();
  };

  const onPointerCancel = () => {
    if (startX.current == null) return;
    startX.current = null;
    startY.current = null;
    axis.current = null;
    setDragging(false);
    setSwipe(0);
  };

  return (
    <div className="notification-swipe">
      <button
        type="button"
        className="notification-swipe-clear"
        tabIndex={offset < -12 ? 0 : -1}
        onClick={onClear}
        aria-label={label}
      >
        Clear
      </button>
      <div
        className={`notification-swipe-panel${dragging ? ' dragging' : ''}`}
        style={{transform: `translate3d(${offset}px,0,0)`}}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
}
