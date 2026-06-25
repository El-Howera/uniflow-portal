/**
 * ChatImagePreview
 *
 * Full-page image preview overlay used by the three chatrooms. Renders
 * via React portal so the `position: fixed` overlay actually covers the
 * viewport — without the portal, ancestors that use `backdrop-filter`
 * (the chat panel + the input bar) create CSS containing blocks that
 * trap the fixed element to a small rectangle.
 *
 * Adds:
 *   - Heavy black + blur backdrop matching the poll modal feel.
 *   - Close button (top-right) AND clicking the backdrop dismisses.
 *   - Download button — fetches the image and triggers a real download
 *     even when the URL is a data: URI (which a plain anchor handles
 *     natively). Falls back to opening the URL in a new tab if the
 *     fetch path fails.
 *   - Escape-key dismissal.
 *   - Filename label below the image.
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';

interface ChatImagePreviewProps {
  url: string;
  name: string;
  onClose: () => void;
}

export const ChatImagePreview: React.FC<ChatImagePreviewProps> = ({ url, name, onClose }) => {
  // Esc to dismiss.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // For data: URIs an anchor's `download` attribute already works in
      // most browsers, but going through fetch + blob is more reliable
      // across Safari quirks and lets us strip the file extension once.
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = name || 'image';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke so the browser actually starts the download.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      // Fallback — open the URL directly.
      window.open(url, '_blank');
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[1000] bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4 cursor-zoom-out"
      onClick={onClose}
    >
      {/* Top action bar — download + close */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-white/10 backdrop-blur-xl border border-white/20 text-white hover:bg-[#6A3FF4]/30 hover:border-[#6A3FF4]/50 transition-all"
          title="Download"
        >
          <i className="ph-bold ph-download-simple text-base"></i>
          <span className="hidden sm:inline">Download</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/10 backdrop-blur-xl border border-white/20 text-white hover:bg-red-500/30 hover:border-red-500/50 transition-all"
          title="Close"
        >
          <i className="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <motion.img
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
        src={url}
        alt={name}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[92vw] max-h-[82vh] object-contain rounded-2xl shadow-2xl cursor-default"
      />
      <p
        className="text-white mt-4 font-semibold text-sm tracking-wide opacity-80"
        onClick={(e) => e.stopPropagation()}
      >
        {name}
      </p>
    </motion.div>,
    document.body
  );
};

export default ChatImagePreview;
