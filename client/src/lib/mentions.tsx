import type { ReactNode } from 'react';
import { splitMentions } from '@metafrasis/shared';

/**
 * Μετατρέπει το κείμενο ενός σχολίου σε κόμβους React, επισημαίνοντας οπτικά τις
 * έγκυρες @αναφορές — ίδιο splitMentions με αυτό που καθορίζει ποιος ειδοποιείται
 * στον server, ώστε η επισήμανση να ταιριάζει ακριβώς με την πραγματικότητα.
 */
export function renderWithMentions(body: string, validUsernames: ReadonlySet<string>): ReactNode {
  const segments = splitMentions(body, validUsernames);
  return segments.map((segment, index) =>
    segment.type === 'mention' ? (
      <span key={index} className="mention">
        @{segment.username}
      </span>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}
