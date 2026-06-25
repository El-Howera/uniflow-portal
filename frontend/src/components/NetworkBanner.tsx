/**
 * Offline / poor-connection banner.
 *
 * Listens to:
 *   - @capacitor/network on native shells (more reliable than navigator.onLine
 *     on mobile because it surveys the actual network interface).
 *   - window 'online' / 'offline' events as the web fallback.
 *
 * Renders a slim amber bar across the top of the screen when offline, slides
 * back out when connection returns. Uses .anim-essential so the reduce-motion
 * preference doesn't suppress the slide — this is genuinely useful feedback,
 * not decoration.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';

export const NetworkBanner: React.FC = () => {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    let detach: (() => void) | null = null;

    (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const { Network } = await import('@capacitor/network');
          const initial = await Network.getStatus();
          setOnline(initial.connected);
          const handle = await Network.addListener('networkStatusChange', (s) => {
            setOnline(s.connected);
          });
          detach = () => handle.remove();
          return;
        } catch (err) {
          console.warn('[network] @capacitor/network unavailable, falling back to navigator.onLine:', err);
        }
      }
      // Web fallback
      const onOnline = () => setOnline(true);
      const onOffline = () => setOnline(false);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      setOnline(navigator.onLine);
      detach = () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    })();

    return () => {
      if (detach) detach();
    };
  }, []);

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          key="network-banner"
          className="anim-essential fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/95 text-black text-xs font-bold backdrop-blur-md shadow-lg"
          initial={{ y: -40 }}
          animate={{ y: 0 }}
          exit={{ y: -40 }}
          transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          role="status"
          aria-live="polite"
        >
          <i className="ph-bold ph-wifi-slash" />
          <span>No internet — changes may not save until you reconnect.</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NetworkBanner;
