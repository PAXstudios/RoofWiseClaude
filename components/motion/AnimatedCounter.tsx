import { useEffect, useRef, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { motion } from '@/theme/tokens';

type Props = {
  value: number;
  /** Renders the in-flight number. Defaults to rounded integer. */
  format?: (n: number) => string;
  style?: StyleProp<TextStyle>;
  durationMs?: number;
};

/**
 * Text that rolls up to its value (ease-out cubic) on mount and whenever
 * the value changes. Used for KPIs and stat tiles so numbers feel earned
 * rather than pasted.
 */
export function AnimatedCounter({
  value,
  format = (n) => String(Math.round(n)),
  style,
  durationMs = motion.countUpMs,
}: Props) {
  const [display, setDisplay] = useState(() => format(0));
  const positionRef = useRef(0); // current animated position
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = positionRef.current;
    const to = value;
    if (from === to) {
      setDisplay(format(to));
      return;
    }
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      positionRef.current = current;
      setDisplay(format(current));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
    // format is intentionally excluded — call sites pass inline lambdas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return <Text style={style}>{display}</Text>;
}
