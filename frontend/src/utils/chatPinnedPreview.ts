/**
 * chatPinnedPreview
 *
 * Picks the right one-line preview for the pinned-message banner. Plain
 * text messages fall through; attachment-only messages need a typed
 * fallback so the banner doesn't render an empty string (the bug that
 * made it look like pinning was broken for images / videos / voice
 * notes / polls).
 *
 * Returns `{ text, icon }` so the banner can also swap the leading icon
 * to match the message kind (image, video, voice, document, poll, plain
 * push-pin).
 */

import { FileAttachment } from './websocketService';

interface PinnedPreviewable {
  message?: string;
  attachment?: FileAttachment | null;
  system?: boolean;
}

interface PinnedPreviewResult {
  text: string;
  icon: string; // phosphor icon class WITHOUT the leading 'ph-' weight
}

const truncate = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function chatPinnedPreview(msg: PinnedPreviewable | undefined): PinnedPreviewResult {
  if (!msg) return { text: '', icon: 'ph-push-pin' };

  // Plain text — most common case, just truncate.
  if (msg.message && msg.message.trim()) {
    return { text: truncate(msg.message.trim()), icon: 'ph-push-pin' };
  }

  // Attachment-driven previews. Polls have a question; everything else
  // gets a "kind: filename" line so the user knows what was pinned even
  // when there's no body text.
  const att = msg.attachment;
  if (att) {
    if (att.type === 'poll' && att.poll) {
      return {
        text: `Poll: ${truncate(att.poll.question, 70)}`,
        icon: 'ph-chart-bar',
      };
    }
    if (att.type === 'image') {
      return { text: `Photo${att.name ? ` · ${att.name}` : ''}`, icon: 'ph-image' };
    }
    if (att.type === 'video') {
      return { text: `Video${att.name ? ` · ${att.name}` : ''}`, icon: 'ph-video-camera' };
    }
    if (att.type === 'audio') {
      return { text: 'Voice note', icon: 'ph-microphone' };
    }
    if (att.type === 'document') {
      return { text: `Document${att.name ? ` · ${att.name}` : ''}`, icon: 'ph-file-text' };
    }
    return { text: att.name || 'Attachment', icon: 'ph-paperclip' };
  }

  if (msg.system) return { text: 'Announcement', icon: 'ph-megaphone' };
  return { text: 'Pinned message', icon: 'ph-push-pin' };
}
