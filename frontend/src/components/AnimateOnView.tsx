import React, { useRef, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useAppContext } from '../context/AppContext';

interface Props {
  children: ReactNode;
  delay?: number;
  className?: string;
  enabled?: boolean;
}

export const AnimateOnView: React.FC<Props> = ({ children, delay = 0, className, enabled = true }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.2 });
  // Plan 8 Phase 2 — global animations toggle. When the user (or OS) turns
  // decorative motion off, fall through to the plain-div path regardless of
  // the per-instance `enabled` prop.
  const { animationsEnabled } = useAppContext();

  if (!enabled || !animationsEnabled) {
    return <div className={`h-full ${className || ''}`}>{children}</div>;
  }

  return (
    <div ref={ref} className={`h-full ${className || ''}`}>
      <motion.div
        className="h-full"
        initial={{ opacity: 0, y: 50 }}
        animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 0.5, delay }}
      >
        {children}
      </motion.div>
    </div>
  );
};
