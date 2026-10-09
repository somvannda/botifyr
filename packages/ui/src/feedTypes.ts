/**
 * The Feed workspace's left-sidebar destinations.
 *
 * `feed` is the timeline; every other value is a dedicated page rendered in the
 * Feed column when selected (see `FeedSidebar` and `FeedView`).
 */
export type FeedSection =
  | "feed"
  | "profile"
  | "friends"
  | "dashboard"
  | "pages"
  | "memories"
  | "saved"
  | "birthdays";
