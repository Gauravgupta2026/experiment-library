const PLACEHOLDER_COUNT = 6;
/** Path of a shipped placeholder image. The index wraps. */
export const placeholder = (i: number): string => `/media/placeholder-${(((i % PLACEHOLDER_COUNT) + PLACEHOLDER_COUNT) % PLACEHOLDER_COUNT) + 1}.svg`;
/** A user image if there is one, else the placeholder. */
export const imageOr = (value: string, fallback: number): string => value || placeholder(fallback);
