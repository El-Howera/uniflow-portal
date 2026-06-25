/**
 * ChatAttachmentMenu — staff-only attachment & voice composer.
 *
 * Renders the paperclip + microphone controls inside a chat input bar.
 * Restricted to system staff (professor / TA / admin) — students don't
 * get attachments or voice notes per the project's section-chat policy.
 *
 * The component is presentation + capture: it returns a fully-formed
 * FileAttachment via the `onAttach` callback. Host pages decide how to
 * route the message (the websocket service's `sendChatMessage` accepts
 * an attachment payload).
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FileAttachment, PollAttachmentPayload } from '../utils/websocketService';

/**
 * PollComposerModal — staff-only modal for composing a chat poll.
 *
 * Shape:
 *   - 1 question (1-200 chars, required)
 *   - 2-6 options (1-100 chars each)
 *   - single-choice (default) vs multiple-choice toggle
 *
 * On submit, returns a PollAttachmentPayload to the host. The host wraps
 * it in a FileAttachment with type='poll' and sends it as a chat message.
 * Glass-morphism shell + purple accent to match the rest of the chat UI.
 */
interface PollComposerModalProps {
  onClose: () => void;
  onSubmit: (payload: PollAttachmentPayload) => void;
}

export const PollComposerModal: React.FC<PollComposerModalProps> = ({ onClose, onSubmit }) => {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateOption = (i: number, v: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  };
  const addOption = () => {
    if (options.length >= 6) return;
    setOptions((prev) => [...prev, '']);
  };
  const removeOption = (i: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = () => {
    const q = question.trim();
    if (!q) {
      setError('Question is required.');
      return;
    }
    if (q.length > 200) {
      setError('Question must be ≤ 200 characters.');
      return;
    }
    const cleaned = options
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    if (cleaned.length < 2) {
      setError('Add at least two options.');
      return;
    }
    if (cleaned.some((o) => o.length > 100)) {
      setError('Each option must be ≤ 100 characters.');
      return;
    }
    onSubmit({
      question: q,
      options: cleaned.map((text, i) => ({
        id: `opt_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        text,
      })),
      multipleChoice,
    });
  };

  // Portal to <body> so the fixed-position overlay actually anchors to the
  // viewport. Without the portal the modal renders inside the chat input
  // bar's `backdrop-filter` ancestor, which creates a CSS containing block
  // that overrides `position: fixed` — pinning the modal to the bottom of
  // the input area instead of centering it on screen.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        // Click outside the card closes the modal.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className="bg-white/10 dark:bg-black/40 border border-white/20 dark:border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl w-full max-w-md p-6 space-y-4 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-black dark:text-white flex items-center gap-2">
            <i className="ph-fill ph-chart-bar text-amber-500"></i>
            New Poll
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-black dark:hover:text-white p-1 transition-colors"
            title="Close"
          >
            <i className="ph-bold ph-x text-lg"></i>
          </button>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
            Question
          </label>
          <input
            type="text"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setError(null);
            }}
            placeholder="What does the class think?"
            maxLength={200}
            className="w-full bg-white/5 dark:bg-black/20 border border-white/15 dark:border-white/10 text-black dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#6A3FF4] backdrop-blur-xl"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
            Options ({options.length}/6)
          </label>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-500 w-5 text-center">
                  {String.fromCharCode(65 + i)}
                </span>
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    updateOption(i, e.target.value);
                    setError(null);
                  }}
                  placeholder={`Option ${i + 1}`}
                  maxLength={100}
                  className="flex-1 bg-white/5 dark:bg-black/20 border border-white/15 dark:border-white/10 text-black dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#6A3FF4] backdrop-blur-xl"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    className="text-gray-400 hover:text-red-500 p-1.5 transition-colors"
                    title="Remove option"
                  >
                    <i className="ph-bold ph-trash text-sm"></i>
                  </button>
                )}
              </div>
            ))}
          </div>
          {options.length < 6 && (
            <button
              type="button"
              onClick={addOption}
              className="mt-2 flex items-center gap-1.5 text-xs text-[#7B5AFF] hover:text-[#6A3FF4] font-semibold transition-colors"
            >
              <i className="ph-bold ph-plus-circle"></i>
              Add option
            </button>
          )}
        </div>

        <div className="flex items-center justify-between p-3 bg-white/5 dark:bg-black/20 border border-white/10 rounded-xl">
          <div className="pr-4">
            <p className="text-xs font-bold text-black dark:text-white">Allow multiple answers</p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Off = each member picks one option. On = members can pick several.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMultipleChoice((v) => !v)}
            aria-pressed={multipleChoice}
            dir="ltr"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors p-0.5 shrink-0 ${
              multipleChoice ? 'bg-[#6A3FF4]' : 'bg-white/10 dark:bg-black/30'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white transform transition-transform ${
                multipleChoice ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold border bg-white/5 dark:bg-black/20 border-white/15 dark:border-white/10 text-black dark:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white hover:opacity-90 shadow-lg shadow-purple-500/20 transition-opacity"
          >
            Send Poll
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};

const compressImage = (file: File, maxWidth = 1200, quality = 0.8): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(file.type || 'image/jpeg', quality));
      } else reject(new Error('Canvas context error'));
    };
    img.onerror = () => reject(new Error('Image load error'));
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsDataURL(file);
  });

const classify = (mimeType: string): string => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType.includes('pdf') ||
    mimeType.includes('document') ||
    mimeType.includes('msword') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('presentation')
  )
    return 'document';
  return 'other';
};

export interface ChatAttachmentMenuProps {
  onAttach: (attachment: FileAttachment) => void;
  onError?: (text: string) => void;
  /**
   * When true, render the staff-only options (Poll). Pass false (or omit)
   * for student composers — students keep Photo / Video / Document but
   * don't get the Poll entry. Default false.
   */
  allowStaffOnly?: boolean;
}

export const ChatAttachmentMenu: React.FC<ChatAttachmentMenuProps> = ({
  onAttach,
  onError,
  allowStaffOnly = false,
}) => {
  const [open, setOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // RTL detection — when html.dir === 'rtl' the paperclip button sits on
  // the RIGHT side of the chat input bar (flex auto-reverses). The popup
  // menu needs to anchor to the RIGHT edge of the paperclip so it doesn't
  // overflow off-screen to the left and get clipped by the chat panel.
  const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  // Localised labels — Arabic strings inline so the component doesn't
  // depend on the global i18n keymap (which is being edited concurrently
  // by a parallel session). Adding the keys to translations.ts later is
  // a non-breaking enhancement; for now this keeps the menu legible in
  // both languages.
  const labels = isRtl
    ? {
        photo:    'صورة',
        photoDesc: 'صورة حتى 15 ميجابايت',
        video:    'فيديو',
        videoDesc: 'مقطع حتى 60 ميجابايت',
        document: 'مستند',
        documentDesc: 'PDF، Word، شرائح — حتى 25 ميجابايت',
        poll:     'استطلاع',
        pollDesc: 'اطرح سؤالاً · إجابة واحدة · نتيجة مباشرة',
        attachFile: 'إرفاق ملف',
      }
    : {
        photo:    'Photo',
        photoDesc: 'Image up to 15 MB',
        video:    'Video',
        videoDesc: 'Clip up to 60 MB',
        document: 'Document',
        documentDesc: 'PDF, Word, slides — up to 25 MB',
        poll:     'Poll',
        pollDesc: 'Ask a question · single answer · live tally',
        attachFile: 'Attach file',
      };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    const t = window.setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', handler);
    };
  }, [open]);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Generous size caps — staff are sharing study materials, not chat
    // emoji. Caps mirror what the legacy student picker enforced.
    const sizeCapMb = file.type.startsWith('image/') ? 15 : file.type.startsWith('video/') ? 60 : 25;
    if (file.size > sizeCapMb * 1024 * 1024) {
      onError?.(`File too large — max ${sizeCapMb} MB.`);
      return;
    }

    try {
      let dataUrl: string;
      let thumbnail: string | undefined;
      if (file.type.startsWith('image/')) {
        dataUrl = await compressImage(file, 1600, 0.85);
        thumbnail = await compressImage(file, 320, 0.6);
      } else {
        dataUrl = await fileToDataUrl(file);
      }
      onAttach({
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        type: classify(file.type),
        mimeType: file.type,
        size: file.size,
        url: dataUrl,
        thumbnail,
      });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not read file.');
    }
    setOpen(false);
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-gray-400 hover:text-[#6A3FF4] p-2"
        title={labels.attachFile}
      >
        <i className={`ph-bold ph-paperclip text-lg transition-transform ${open ? 'rotate-45' : ''}`}></i>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`absolute bottom-full ${isRtl ? 'right-0' : 'left-0'} mb-2 bg-white/95 dark:bg-[#141414]/95 rounded-2xl shadow-2xl border border-white/30 dark:border-white/10 backdrop-blur-2xl overflow-hidden min-w-[260px] z-[60]`}
          >
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-3 px-4 py-3 hover:bg-[#6A3FF4]/10 w-full text-start transition-colors border-b border-white/10"
            >
              <div className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <i className="ph-fill ph-image text-purple-500 text-lg"></i>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-black dark:text-white">{labels.photo}</p>
                <p className="text-[10px] text-gray-500">{labels.photoDesc}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="flex items-center gap-3 px-4 py-3 hover:bg-[#6A3FF4]/10 w-full text-start transition-colors border-b border-white/10"
            >
              <div className="w-9 h-9 rounded-full bg-pink-500/20 flex items-center justify-center flex-shrink-0">
                <i className="ph-fill ph-video-camera text-pink-500 text-lg"></i>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-black dark:text-white">{labels.video}</p>
                <p className="text-[10px] text-gray-500">{labels.videoDesc}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-[#6A3FF4]/10 w-full text-start transition-colors ${
                allowStaffOnly ? 'border-b border-white/10' : ''
              }`}
            >
              <div className="w-9 h-9 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <i className="ph-fill ph-file-text text-blue-500 text-lg"></i>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-black dark:text-white">{labels.document}</p>
                <p className="text-[10px] text-gray-500">{labels.documentDesc}</p>
              </div>
            </button>
            {allowStaffOnly && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPollOpen(true);
                }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[#6A3FF4]/10 w-full text-start transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <i className="ph-fill ph-chart-bar text-amber-500 text-lg"></i>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-black dark:text-white">{labels.poll}</p>
                  <p className="text-[10px] text-gray-500">{labels.pollDesc}</p>
                </div>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {pollOpen && (
        <PollComposerModal
          onClose={() => setPollOpen(false)}
          onSubmit={(payload) => {
            onAttach({
              id: `poll_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              name: payload.question.slice(0, 60) || 'Poll',
              type: 'poll',
              mimeType: 'application/x.uniflow.poll',
              size: 0,
              url: '',
              poll: payload,
            });
            setPollOpen(false);
          }}
        />
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handlePick} />
      <input
        ref={imageInputRef}
        type="file"
        className="hidden"
        onChange={handlePick}
        accept="image/*"
      />
      <input
        ref={videoInputRef}
        type="file"
        className="hidden"
        onChange={handlePick}
        accept="video/*"
      />
    </div>
  );
};

export interface VoiceRecorderProps {
  onRecorded: (attachment: FileAttachment) => void;
  onError?: (text: string) => void;
}

/**
 * VoiceRecorder — push-to-record button. First click starts capturing
 * via MediaRecorder; second click stops + emits the recorded blob as a
 * FileAttachment with type 'audio'. Live mm:ss counter while recording.
 *
 * Browser support: Chrome / Edge / Firefox / Safari 14+. The button
 * silently disables itself if the runtime can't expose a media recorder.
 */
export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onRecorded, onError }) => {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<number | null>(null);

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined';

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stopTimer = () => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startRecording = async () => {
    if (!supported) {
      onError?.('Voice recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          onRecorded({
            id: `voice_${Date.now()}`,
            name: `voice-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`,
            type: 'audio',
            mimeType: blob.type,
            size: blob.size,
            url: reader.result as string,
          });
        };
        reader.onerror = () => onError?.('Could not encode the recording.');
        reader.readAsDataURL(blob);
        stopStream();
        stopTimer();
        setSeconds(0);
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
      const startedAt = Date.now();
      intervalRef.current = window.setInterval(
        () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
        250,
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Microphone permission denied.');
      stopStream();
      setRecording(false);
    }
  };

  const cancelRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      } catch { /* noop */ }
    }
    stopStream();
    stopTimer();
    setSeconds(0);
    setRecording(false);
    chunksRef.current = [];
  };

  const stopAndSend = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch (e) {
        onError?.(e instanceof Error ? e.message : 'Failed to finalise recording.');
      }
    }
  };

  // Tidy up if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      stopStream();
      stopTimer();
    };
  }, []);

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        className="text-gray-500 p-2 cursor-not-allowed"
        title="Voice notes not supported on this device"
      >
        <i className="ph-bold ph-microphone-slash text-lg"></i>
      </button>
    );
  }

  if (!recording) {
    return (
      <button
        type="button"
        onClick={startRecording}
        className="text-gray-400 hover:text-[#6A3FF4] p-2 transition-colors"
        title="Record voice note"
      >
        <i className="ph-fill ph-microphone text-lg"></i>
      </button>
    );
  }

  // Recording UI — shows the live duration + cancel + send buttons.
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-red-500">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
        {mm}:{ss}
      </span>
      <button
        type="button"
        onClick={cancelRecording}
        className="w-7 h-7 rounded-full bg-white/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors"
        title="Discard"
      >
        <i className="ph-bold ph-trash text-xs"></i>
      </button>
      <button
        type="button"
        onClick={stopAndSend}
        className="w-7 h-7 rounded-full bg-[#6A3FF4] hover:bg-[#5A32D4] text-white flex items-center justify-center transition-colors"
        title="Send"
      >
        <i className="ph-bold ph-paper-plane-tilt text-xs"></i>
      </button>
    </div>
  );
};

export default ChatAttachmentMenu;
