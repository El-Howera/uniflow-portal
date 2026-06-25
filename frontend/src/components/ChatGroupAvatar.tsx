// Shared chat-group avatar. Renders either the group's uploaded photo OR
// course-name initials inside a purple gradient — matching the profile avatar
// style used in the header (initials of "Elfares Howera" → "EH").
//
// Replaces three older patterns scattered across the four chatroom variants
// and ChatGroupInfoPanel:
//   - flat purple square showing the courseCode text ("CS101")
//   - flat purple circle with a generic ph-users-three icon
//   - flat purple icon in the info panel hero
// All three are now visually consistent with the user-profile avatar.
import React from 'react';
import { API_URLS } from '@shared/config';

export interface ChatGroupAvatarSource {
  courseTitle?: string | null;
  name?: string | null;
  courseCode?: string | null;
  photoUrl?: string | null;
}

/**
 * Pull initials from the most-descriptive course label available. The group
 * `name` is shaped like "Database Systems — Lecture L1 — Mon 10:00–12:00" so
 * we split on the em-dash separator and use only the title portion.
 *
 * Mirrors the user-profile initials rule (first letter of first 2 words; falls
 * back to first 2 letters when there's only one word).
 */
export function courseInitials(group: ChatGroupAvatarSource): string {
  const source =
    group.courseTitle?.trim() ||
    group.name?.split(' — ')[0]?.trim() ||
    group.courseCode?.trim() ||
    '?';
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

const photoSrc = (photoUrl: string | null | undefined): string | null => {
  if (!photoUrl) return null;
  return photoUrl.startsWith('http') ? photoUrl : `${API_URLS.chat()}${photoUrl}`;
};

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'hero';
type Shape = 'square' | 'round';

const SIZE_CLASS: Record<Size, { box: string; text: string }> = {
  xs:   { box: 'w-7 h-7',    text: 'text-[10px]' },
  sm:   { box: 'w-9 h-9',    text: 'text-xs' },
  md:   { box: 'w-10 h-10',  text: 'text-xs' },
  lg:   { box: 'w-12 h-12',  text: 'text-sm' },
  hero: { box: 'w-20 h-20',  text: 'text-2xl' },
};

interface Props {
  group: ChatGroupAvatarSource;
  size?: Size;
  shape?: Shape;
  className?: string;
}

const ChatGroupAvatar: React.FC<Props> = ({
  group,
  size = 'md',
  shape = 'square',
  className = '',
}) => {
  const src = photoSrc(group.photoUrl);
  const { box, text } = SIZE_CLASS[size];
  const radius = shape === 'round' ? 'rounded-full' : 'rounded-lg';

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`${box} ${radius} object-cover flex-shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${box} ${radius} bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white ${text} font-bold flex-shrink-0 ${className}`}
      aria-hidden="true"
    >
      {courseInitials(group)}
    </div>
  );
};

export default ChatGroupAvatar;
