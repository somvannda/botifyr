import { useState } from "react";
import type { ReactNode } from "react";
import type { Page } from "@botifyr/client";
import type { User } from "@botifyr/shared";
import { Avatar, resolveAvatar } from "./feedKit";
import {
  BookmarkIcon,
  ChartIcon,
  ChevronIcon,
  ClockIcon,
  GiftIcon,
  HomeIcon,
  PanelIcon,
  PlusIcon,
  UserIcon,
  UsersIcon,
} from "./Icons";
import type { FeedSection } from "./feedTypes";

/**
 * The Feed workspace's left navigation (docs/feed.md).
 *
 * Replaces the chat list in the app sidebar while the Feed is active. Each row
 * selects a destination; the Pages row expands into an identity switcher so the
 * user can jump between their personal profile and the Pages they manage.
 */
export function FeedSidebar({
  user,
  cloudUrl,
  active,
  onNavigate,
  pages,
  actingPage,
  onActPage,
  onOpenPage,
  onCreatePage,
  friendRequests,
  birthdays,
}: {
  user: User;
  cloudUrl: string;
  active: FeedSection;
  onNavigate: (section: FeedSection) => void;
  pages: Page[];
  /** The Page the account is currently acting as, or null for the profile. */
  actingPage: Page | null;
  onActPage: (page: Page | null) => void;
  onOpenPage: (handle: string) => void;
  onCreatePage: () => void;
  /** Incoming friend requests, shown as a badge on Friends. */
  friendRequests: number;
  /** Friends with a birthday in the next 7 days, shown as a badge. */
  birthdays: number;
}) {
  const [pagesOpen, setPagesOpen] = useState(false);
  const identityName = actingPage ? actingPage.name : user.displayName || user.handle || user.email;
  const identityEmoji = actingPage ? (actingPage.avatarEmoji ?? "📄") : (user.avatarEmoji ?? "🙂");
  const identityUrl = resolveAvatar(actingPage ? actingPage.avatarUrl : user.avatarUrl, cloudUrl);

  const row = (
    section: FeedSection,
    icon: ReactNode,
    label: string,
    badge?: number,
  ): ReactNode => (
    <button
      key={section}
      type="button"
      className={`feed-side-item${active === section ? " active" : ""}`}
      aria-current={active === section ? "page" : undefined}
      onClick={() => onNavigate(section)}
    >
      <span className="feed-side-ico" aria-hidden="true">
        {icon}
      </span>
      <span className="feed-side-label">{label}</span>
      {badge !== undefined && badge > 0 && <span className="feed-side-badge">{badge}</span>}
    </button>
  );

  return (
    <nav className="feed-side" aria-label="Feed navigation">
      <button
        type="button"
        className={`feed-side-identity${active === "feed" ? " active" : ""}`}
        onClick={() => onNavigate("feed")}
        title="Go to your Feed"
      >
        <Avatar url={identityUrl} emoji={identityEmoji} name={identityName} size={38} />
        <span className="feed-side-identity-text">
          <span className="feed-side-identity-name">{identityName}</span>
          <span className="feed-side-identity-sub">{actingPage ? "Acting as Page" : "Your profile"}</span>
        </span>
      </button>

      <div className="feed-side-list">
        {row("feed", <HomeIcon size={18} />, "Feed")}
        {row("profile", <UserIcon size={18} />, "Profile")}
        {row("friends", <UsersIcon size={18} />, "Friends", friendRequests)}
        {row("dashboard", <ChartIcon size={18} />, "Dashboard")}

        <div className="feed-side-group">
          <button
            type="button"
            className={`feed-side-item${active === "pages" ? " active" : ""}`}
            aria-expanded={pagesOpen}
            onClick={() => {
              setPagesOpen((value) => !value);
              onNavigate("pages");
            }}
          >
            <span className="feed-side-ico" aria-hidden="true">
              <PanelIcon size={18} />
            </span>
            <span className="feed-side-label">Pages</span>
            <span className={`feed-side-caret${pagesOpen ? " open" : ""}`} aria-hidden="true">
              <ChevronIcon size={15} />
            </span>
          </button>
          {pagesOpen && (
            <div className="feed-side-pages">
              <button
                type="button"
                className={`feed-side-page${!actingPage ? " current" : ""}`}
                onClick={() => {
                  onActPage(null);
                  onNavigate("feed");
                }}
              >
                <Avatar
                  url={resolveAvatar(user.avatarUrl, cloudUrl)}
                  emoji={user.avatarEmoji ?? "🙂"}
                  name={identityName}
                  size={22}
                />
                <span className="feed-side-page-name">Your profile</span>
                {!actingPage && <span className="feed-side-page-tag">Acting</span>}
              </button>
              {pages.map((page) => (
                <div key={page.id} className="feed-side-page-row">
                  <button
                    type="button"
                    className={`feed-side-page${actingPage?.id === page.id ? " current" : ""}`}
                    onClick={() => {
                      onActPage(page);
                      onNavigate("feed");
                    }}
                  >
                    <Avatar
                      url={resolveAvatar(page.avatarUrl, cloudUrl)}
                      emoji={page.avatarEmoji ?? "📄"}
                      name={page.name}
                      size={22}
                    />
                    <span className="feed-side-page-name">{page.name}</span>
                    {actingPage?.id === page.id && <span className="feed-side-page-tag">Acting</span>}
                  </button>
                  <button
                    type="button"
                    className="feed-side-page-view"
                    title={`View ${page.name}`}
                    aria-label={`View ${page.name}`}
                    onClick={() => onOpenPage(page.handle)}
                  >
                    <ChevronIcon size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="feed-side-page feed-side-page-new" onClick={onCreatePage}>
                <span className="feed-side-page-plus" aria-hidden="true">
                  <PlusIcon size={14} />
                </span>
                <span className="feed-side-page-name">Create Page</span>
              </button>
            </div>
          )}
        </div>

        {row("memories", <ClockIcon size={18} />, "Memories")}
        {row("saved", <BookmarkIcon size={18} />, "Saved")}
        {row("birthdays", <GiftIcon size={18} />, "Birthdays", birthdays)}
      </div>
    </nav>
  );
}
