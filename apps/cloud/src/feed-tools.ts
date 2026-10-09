import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import { emit } from "./events.js";
import type { Store } from "./store/index.js";
import type { GroupRecord, PageRecord, PageRole, PostRecord, ReactionType } from "./store/types.js";

/**
 * Feed hands (docs/feed.md, docs/feed-next.md): let a bot read Botifyr's own
 * social surface and act on it — posts, reels, comments, Pages, and Groups.
 *
 * A bot shares its owner's account, so a "self" post is the owner's profile.
 * Prefer acting as a Page the bot manages (pass `page`); a post to the owner's
 * own profile is always approval-gated. Reads cost nothing (no model spend);
 * everything that publishes, replies, joins, or moderates is `requiresApproval`.
 */

const MAX_POST_BODY = 4000;
const REACTIONS: ReactionType[] = ["like", "love", "care", "haha", "wow", "sad", "angry"];

/** The identity a Feed tool acts with. */
export interface FeedToolContext {
  /** The account that authors feed actions (a bot shares its owner's account). */
  userId: string;
  /** The bot id, matched against `Page.botId` to recognise Pages it owns. */
  botId: string;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function preview(body: string, max = 90): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function isFutureScheduled(post: PostRecord, nowIso: string): boolean {
  return Boolean(post.scheduledAt && post.scheduledAt > nowIso);
}

export function createFeedTools(store: Store, ctx: FeedToolContext): ToolDefinition[] {
  const resolvePage = async (ref: string): Promise<PageRecord | null> => {
    const trimmed = ref.trim();
    if (!trimmed) return null;
    return (await store.getPage(trimmed)) ?? (await store.getPageByHandle(slugify(trimmed)));
  };

  /** The bot's role on a Page: owner/bot-linked ⇒ admin, else its bot role, then its owner's role. */
  const pageRole = async (page: PageRecord): Promise<PageRole | "admin" | null> => {
    if (page.ownerId === ctx.userId || page.botId === ctx.botId) return "admin";
    const botRole = await store.getPageBotRole(page.id, ctx.botId);
    if (botRole) return botRole.role;
    return (await store.getPageRole(page.id, ctx.userId))?.role ?? null;
  };

  const canManagePage = async (page: PageRecord): Promise<boolean> => {
    const role = await pageRole(page);
    return role === "admin" || role === "editor";
  };

  const canModeratePage = async (page: PageRecord): Promise<boolean> => {
    const role = await pageRole(page);
    return role === "admin" || role === "editor" || role === "moderator";
  };

  const resolveGroup = async (ref: string): Promise<GroupRecord | null> => {
    const trimmed = ref.trim();
    if (!trimmed) return null;
    return (await store.getGroup(trimmed)) ?? (await store.getGroupByHandle(slugify(trimmed)));
  };

  /** Publish a post record and fan out hashtags, mentions, polls, and events. */
  const publish = async (input: {
    authorId: string;
    body: string;
    pageId?: string;
    groupId?: string;
    mediaIds?: string[];
    audience?: "public" | "friends" | "only_me";
    scheduledAt?: string;
    poll?: string[];
    repostOf?: string;
  }): Promise<PostRecord> => {
    const now = new Date().toISOString();
    const mediaIds = input.mediaIds ?? [];
    const record: PostRecord = {
      id: randomUUID(),
      authorId: input.authorId,
      body: input.body,
      mediaId: mediaIds[0],
      pageId: input.pageId,
      groupId: input.groupId,
      repostOf: input.repostOf,
      audience: input.audience ?? "friends",
      scheduledAt: input.scheduledAt,
      createdAt: now,
      updatedAt: now,
    };
    await store.createPost(record);
    for (const [index, mediaId] of mediaIds.entries()) {
      await store.addPostMedia(record.id, mediaId, index);
    }
    for (const tag of new Set(
      [...input.body.matchAll(/(?:^|\s)#([A-Za-z0-9_]{1,50})/g)].map((match) => match[1].toLowerCase()),
    )) {
      await store.addPostTag(record.id, tag);
    }
    const mentionHandles = new Set(
      [...input.body.matchAll(/@([A-Za-z0-9_]{3,30})/g)].map((match) => match[1].toLowerCase()),
    );
    if (mentionHandles.size > 0) {
      const actor = await store.getUserById(input.authorId);
      const fromName = actor?.displayName ?? actor?.handle;
      for (const handle of mentionHandles) {
        const user = await store.getUserByHandle(handle);
        if (user && user.id !== input.authorId) {
          emit({
            type: "feed.mention",
            postId: record.id,
            fromUserId: input.authorId,
            fromName,
            toUserId: user.id,
          });
        }
      }
    }
    if (input.poll && input.poll.length >= 2) await store.createPoll(record.id, input.poll);
    const friendIds = await store.listFriends(input.authorId).catch(() => [] as string[]);
    emit({
      type: "feed.post",
      postId: record.id,
      authorId: input.authorId,
      toUserIds: [input.authorId, ...friendIds],
    });
    return record;
  };

  const targetOf = async (
    args: Record<string, unknown>,
  ): Promise<{ ok: true; authorId: string; page?: PageRecord; group?: GroupRecord } | { ok: false; output: string }> => {
    let authorId = ctx.userId;
    let page: PageRecord | undefined;
    let group: GroupRecord | undefined;
    const pageRef = String(args.page ?? "").trim();
    if (pageRef) {
      const found = await resolvePage(pageRef);
      if (!found) return { ok: false, output: `No Page matches "${pageRef}".` };
      if (!(await canManagePage(found))) {
        return { ok: false, output: `You can't post as @${found.handle} (editor/admin required).` };
      }
      page = found;
      authorId = found.id;
    }
    const groupRef = String(args.group ?? "").trim();
    if (groupRef) {
      const found = await resolveGroup(groupRef);
      if (!found) return { ok: false, output: `No Group matches "${groupRef}".` };
      if (!(await store.isGroupMember(found.id, ctx.userId))) {
        return { ok: false, output: `Join "${found.name}" before posting.` };
      }
      group = found;
    }
    return { ok: true, authorId, page, group };
  };

  return [
    {
      name: "feed.read",
      description:
        "Read Botifyr's Feed. source=home (your timeline), page, group, user, or tag; query = a handle/tag. Returns real post ids to act on with feed.thread/feed.engage.",
      parameters: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["home", "page", "group", "user", "tag"],
            description: "Where to read from (default home).",
          },
          query: { type: "string", description: "Page/group/user handle or #tag (omit for home)." },
          limit: { type: "number", description: "Max posts (1–25, default 10)." },
        },
        required: [],
      },
      run: async (args) => {
        const source = String(args.source ?? "home").toLowerCase();
        const query = String(args.query ?? "").trim();
        const limit = clamp(args.limit, 1, 25, 10);
        const nowIso = new Date().toISOString();
        const blocked = new Set(await store.listBlockedEither(ctx.userId));
        let posts: PostRecord[] = [];
        let label = "your Home feed";
        if (source === "page") {
          const page = await resolvePage(query);
          if (!page) return { ok: false, output: `No Page matches "${query}".` };
          posts = await store.listPostsByAuthor(page.id, limit);
          label = `Page @${page.handle}`;
        } else if (source === "group") {
          const group = await resolveGroup(query);
          if (!group) return { ok: false, output: `No Group matches "${query}".` };
          if (group.privacy === "private" && !(await store.isGroupMember(group.id, ctx.userId))) {
            return { ok: false, output: `Group "${group.name}" is private; join it first.` };
          }
          posts = await store.listGroupPosts(group.id, limit);
          label = `Group "${group.name}"`;
        } else if (source === "tag") {
          const tag = slugify(query.replace(/^#/, "")) || query.toLowerCase();
          posts = await store.listPostsByTag(tag, limit);
          label = `#${tag}`;
        } else if (source === "user") {
          const user = await store.getUserByHandle(slugify(query));
          if (!user) return { ok: false, output: `No user @${query}.` };
          posts = await store.listPostsByAuthor(user.id, limit);
          label = `@${user.handle}`;
        } else {
          const friends = (await store.listFriends(ctx.userId)).filter((id) => !blocked.has(id));
          const pages = (await store.listFollowedPageIds(ctx.userId)).filter((id) => !blocked.has(id));
          posts = await store.listFeedPosts([ctx.userId, ...friends, ...pages], limit * 2);
        }
        const visible = posts
          .filter((post) => !blocked.has(post.authorId))
          .filter((post) => post.audience !== "only_me" || post.authorId === ctx.userId)
          .filter((post) => !isFutureScheduled(post, nowIso) || post.authorId === ctx.userId)
          .slice(0, limit);
        if (visible.length === 0) return { ok: true, output: `No posts found in ${label}.` };
        const lines: string[] = [];
        for (const post of visible) {
          const stats = await store.getPostStats(post.id, ctx.userId);
          const where = post.pageId
            ? `page:${post.pageId}`
            : post.groupId
              ? `group:${post.groupId}`
              : `user:${post.authorId}`;
          lines.push(
            `- ${post.id} · ${where} · ${stats.likes} reactions, ${stats.comments} comments — "${preview(post.body)}"`,
          );
        }
        return { ok: true, output: `${label} (${visible.length}):\n${lines.join("\n")}` };
      },
    },
    {
      name: "feed.insights",
      description:
        "Read a Page's recent performance (followers, 30-day reactions/comments/shares, top posts). Requires a manager role on the Page.",
      parameters: {
        type: "object",
        properties: { page: { type: "string", description: "Page handle or id." } },
        required: ["page"],
      },
      run: async (args) => {
        const page = await resolvePage(String(args.page ?? ""));
        if (!page) return { ok: false, output: `No Page matches "${args.page}".` };
        const role = await pageRole(page);
        if (role !== "admin" && role !== "editor" && role !== "analyst") {
          return { ok: false, output: `You don't manage @${page.handle}.` };
        }
        const posts = await store.listPostsByAuthor(page.id, 200);
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        let reactions = 0;
        let comments = 0;
        let shares = 0;
        const ranked: Array<{ body: string; engagement: number }> = [];
        for (const post of posts) {
          const stats = await store.getPostStats(post.id, page.id);
          reactions += stats.likes;
          comments += stats.comments;
          shares += stats.shares;
          if (post.createdAt >= since) {
            ranked.push({ body: post.body, engagement: stats.likes + stats.comments + stats.shares });
          }
        }
        ranked.sort((a, b) => b.engagement - a.engagement);
        const top = ranked
          .slice(0, 5)
          .map((post) => `  • ${post.engagement} — "${preview(post.body, 60)}"`)
          .join("\n");
        return {
          ok: true,
          output: `@${page.handle}: ${await store.countPageFollowers(page.id)} followers, ${posts.length} posts, 30d — ${reactions} reactions / ${comments} comments / ${shares} shares.${top ? `\nTop posts:\n${top}` : ""}`,
        };
      },
    },
    {
      name: "feed.post",
      description:
        "Publish a Feed post. Acts as the bot's owner unless `page` names a Page it manages. Needs approval. Optionally schedule it, attach media, or add a poll.",
      parameters: {
        type: "object",
        properties: {
          body: { type: "string", description: "The post text (may be empty when media is attached)." },
          audience: {
            type: "string",
            enum: ["public", "friends", "only_me"],
            description: "Who can see it (default friends).",
          },
          page: { type: "string", description: "Page handle/id to post as (preferred)." },
          group: { type: "string", description: "Group handle/id to post into (must be a member)." },
          mediaIds: {
            type: "array",
            items: { type: "string" },
            description: "Existing media ids to attach (up to 4).",
          },
          scheduledAt: { type: "string", description: "ISO time to publish later." },
          poll: {
            type: "array",
            items: { type: "string" },
            description: "2–4 poll options (adds a poll).",
          },
        },
        required: ["body"],
      },
      requiresApproval: true,
      run: async (args) => {
        const body = String(args.body ?? "").trim().slice(0, MAX_POST_BODY);
        const mediaIds = Array.isArray(args.mediaIds)
          ? args.mediaIds
              .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
              .map((id) => id.trim())
              .slice(0, 4)
          : [];
        const poll = Array.isArray(args.poll)
          ? args.poll
              .filter((label): label is string => typeof label === "string" && label.trim().length > 0)
              .map((label) => label.trim().slice(0, 80))
              .slice(0, 4)
          : [];
        if (!body && mediaIds.length === 0) return { ok: false, output: "A post needs text or media." };
        const target = await targetOf(args);
        if (!target.ok) return target;
        const audience =
          args.audience === "public" || args.audience === "only_me" ? args.audience : "friends";
        const scheduledRaw = String(args.scheduledAt ?? "").trim();
        const scheduledAt =
          scheduledRaw && new Date(scheduledRaw).getTime() > Date.now()
            ? new Date(scheduledRaw).toISOString()
            : undefined;
        const record = await publish({
          authorId: target.authorId,
          body,
          pageId: target.page?.id,
          groupId: target.group?.id,
          mediaIds,
          audience,
          scheduledAt,
          poll,
        });
        const as = target.page ? ` as @${target.page.handle}` : "";
        const to = target.group ? ` into "${target.group.name}"` : "";
        return {
          ok: true,
          output: `Posted${as}${to}${scheduledAt ? " (scheduled)" : ""} — post ${record.id}.`,
        };
      },
    },
    {
      name: "feed.reel",
      description:
        "Publish a Reel (a vertical video post). Needs an already-uploaded video `mediaId`. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          mediaId: { type: "string", description: "The uploaded video's media id." },
          caption: { type: "string", description: "Optional caption." },
          page: { type: "string", description: "Page handle/id to post as (optional)." },
        },
        required: ["mediaId"],
      },
      requiresApproval: true,
      run: async (args) => {
        const mediaId = String(args.mediaId ?? "").trim();
        if (!mediaId) return { ok: false, output: "mediaId is required — upload the video first." };
        const target = await targetOf(args);
        if (!target.ok) return target;
        const record = await publish({
          authorId: target.authorId,
          body: String(args.caption ?? "").trim().slice(0, MAX_POST_BODY),
          pageId: target.page?.id,
          mediaIds: [mediaId],
          audience: "public",
        });
        return { ok: true, output: `Posted a Reel — post ${record.id}.` };
      },
    },
    {
      name: "feed.thread",
      description:
        "Reply on a Feed post: pass `commentId` to reply to a comment (thread), or `postId` to add a top-level comment. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          body: { type: "string", description: "The reply text." },
          commentId: { type: "string", description: "Comment to reply to." },
          postId: { type: "string", description: "Post to comment on (use when not replying to a comment)." },
        },
        required: ["body"],
      },
      requiresApproval: true,
      run: async (args) => {
        const body = String(args.body ?? "").trim().slice(0, MAX_POST_BODY);
        if (!body) return { ok: false, output: "A reply needs text." };
        let postId = String(args.postId ?? "").trim();
        let parentId: string | undefined;
        const commentId = String(args.commentId ?? "").trim();
        if (commentId) {
          const parent = await store.getPostComment(commentId);
          if (!parent) return { ok: false, output: `No comment ${commentId}.` };
          postId = parent.postId;
          parentId = parent.id;
        }
        if (!postId) return { ok: false, output: "Provide commentId or postId." };
        const post = await store.getPost(postId);
        if (!post) return { ok: false, output: `No post ${postId}.` };
        const comment = {
          id: randomUUID(),
          postId,
          authorId: ctx.userId,
          body,
          parentId,
          createdAt: new Date().toISOString(),
        };
        await store.createPostComment(comment);
        if (post.authorId !== ctx.userId) {
          const actor = await store.getUserById(ctx.userId);
          emit({
            type: "feed.comment",
            postId,
            fromUserId: ctx.userId,
            fromName: actor?.displayName ?? actor?.handle,
            toUserId: post.authorId,
          });
        }
        return { ok: true, output: `Replied — comment ${comment.id}.` };
      },
    },
    {
      name: "feed.engage",
      description:
        "Engage with a Feed post: action=react (with a reaction), unreact, repost (optional caption), share, or unshare. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          postId: { type: "string", description: "The post id (from feed.read)." },
          action: {
            type: "string",
            enum: ["react", "unreact", "repost", "share", "unshare"],
            description: "What to do.",
          },
          reaction: {
            type: "string",
            enum: REACTIONS,
            description: "For action=react.",
          },
          caption: { type: "string", description: "For action=repost." },
        },
        required: ["postId", "action"],
      },
      requiresApproval: true,
      run: async (args) => {
        const postId = String(args.postId ?? "").trim();
        const action = String(args.action ?? "").trim().toLowerCase();
        const post = await store.getPost(postId);
        if (!post) return { ok: false, output: `No post ${postId}.` };
        const actor = await store.getUserById(ctx.userId);
        const fromName = actor?.displayName ?? actor?.handle;
        const notify = (type: "feed.like" | "feed.share") => {
          if (post.authorId !== ctx.userId) {
            emit({ type, postId, fromUserId: ctx.userId, fromName, toUserId: post.authorId });
          }
        };
        if (action === "react") {
          const reaction = String(args.reaction ?? "").trim() as ReactionType;
          if (!REACTIONS.includes(reaction)) {
            return { ok: false, output: `Pick a reaction: ${REACTIONS.join(", ")}.` };
          }
          await store.setPostReaction(postId, ctx.userId, reaction);
          notify("feed.like");
          return { ok: true, output: `Reacted ${reaction} on ${postId}.` };
        }
        if (action === "unreact") {
          await store.setPostReaction(postId, ctx.userId, null);
          return { ok: true, output: `Removed your reaction on ${postId}.` };
        }
        if (action === "repost") {
          const caption = String(args.caption ?? "").trim().slice(0, MAX_POST_BODY);
          const repost = await publish({ authorId: ctx.userId, body: caption, repostOf: postId });
          await store.setPostShare(postId, ctx.userId, true);
          notify("feed.share");
          return { ok: true, output: `Reposted ${postId} — post ${repost.id}.` };
        }
        if (action === "share") {
          await store.setPostShare(postId, ctx.userId, true);
          notify("feed.share");
          return { ok: true, output: `Shared ${postId}.` };
        }
        if (action === "unshare") {
          await store.setPostShare(postId, ctx.userId, false);
          return { ok: true, output: `Unshared ${postId}.` };
        }
        return { ok: false, output: `Unknown action "${action}".` };
      },
    },
    {
      name: "group.join",
      description:
        "Join a Group (public) or request to join a private one. Needs approval. group.post requires membership first.",
      parameters: {
        type: "object",
        properties: { group: { type: "string", description: "Group handle or id." } },
        required: ["group"],
      },
      requiresApproval: true,
      run: async (args) => {
        const group = await resolveGroup(String(args.group ?? ""));
        if (!group) return { ok: false, output: `No Group matches "${args.group}".` };
        if (await store.isGroupMember(group.id, ctx.userId)) {
          return { ok: true, output: `Already a member of "${group.name}".` };
        }
        if (group.privacy === "public") {
          await store.setGroupMember({ groupId: group.id, userId: ctx.userId, role: "member" });
          return { ok: true, output: `Joined "${group.name}".` };
        }
        const existing = await store.getGroupJoinRequest(group.id, ctx.userId);
        if (existing?.status === "pending") {
          return { ok: true, output: `Your request to join "${group.name}" is already pending.` };
        }
        const now = new Date().toISOString();
        await store.setGroupJoinRequest({
          groupId: group.id,
          userId: ctx.userId,
          status: "pending",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return { ok: true, output: `Requested to join "${group.name}" (pending approval).` };
      },
    },
    {
      name: "group.post",
      description: "Post into a Group the bot's account is a member of. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          group: { type: "string", description: "Group handle or id." },
          body: { type: "string", description: "The post text." },
          mediaIds: {
            type: "array",
            items: { type: "string" },
            description: "Existing media ids to attach (up to 4).",
          },
        },
        required: ["group", "body"],
      },
      requiresApproval: true,
      run: async (args) => {
        const body = String(args.body ?? "").trim().slice(0, MAX_POST_BODY);
        const mediaIds = Array.isArray(args.mediaIds)
          ? args.mediaIds
              .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
              .map((id) => id.trim())
              .slice(0, 4)
          : [];
        if (!body && mediaIds.length === 0) return { ok: false, output: "A post needs text or media." };
        const group = await resolveGroup(String(args.group ?? ""));
        if (!group) return { ok: false, output: `No Group matches "${args.group}".` };
        if (!(await store.isGroupMember(group.id, ctx.userId))) {
          return { ok: false, output: `Join "${group.name}" before posting (use group.join).` };
        }
        const record = await publish({ authorId: ctx.userId, body, groupId: group.id, mediaIds });
        return { ok: true, output: `Posted into "${group.name}" — post ${record.id}.` };
      },
    },
    {
      name: "page.manage",
      description:
        "Manage a Page: update its profile, set/remove member roles, pin/unpin a post, or follow/unfollow it. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "string", description: "Page handle or id." },
          action: {
            type: "string",
            enum: ["update", "setRole", "removeRole", "pin", "unpin", "follow", "unfollow"],
            description: "What to do.",
          },
          name: { type: "string" },
          handle: { type: "string", description: "New handle (action=update)." },
          about: { type: "string" },
          category: { type: "string" },
          cta: { type: "string", description: "Call-to-action label." },
          ctaUrl: { type: "string" },
          userId: { type: "string", description: "For setRole/removeRole: the member's user id." },
          botId: { type: "string", description: "For setRole/removeRole: a bot you own (instead of userId)." },
          role: {
            type: "string",
            enum: ["admin", "editor", "moderator", "analyst"],
            description: "For setRole.",
          },
          postId: { type: "string", description: "For pin." },
        },
        required: ["page", "action"],
      },
      requiresApproval: true,
      run: async (args) => {
        const page = await resolvePage(String(args.page ?? ""));
        if (!page) return { ok: false, output: `No Page matches "${args.page}".` };
        const role = await pageRole(page);
        const action = String(args.action ?? "").trim().toLowerCase();
        if (action === "follow") {
          await store.followPage(page.id, ctx.userId);
          return { ok: true, output: `Following @${page.handle}.` };
        }
        if (action === "unfollow") {
          await store.unfollowPage(page.id, ctx.userId);
          return { ok: true, output: `Unfollowed @${page.handle}.` };
        }
        if (role !== "admin" && role !== "editor") {
          return { ok: false, output: `You don't manage @${page.handle}.` };
        }
        if (action === "update") {
          if (typeof args.name === "string" && args.name.trim()) page.name = args.name.trim().slice(0, 60);
          if (typeof args.handle === "string" && args.handle.trim()) {
            const handle = slugify(args.handle);
            const clash = await store.getPageByHandle(handle);
            if (clash && clash.id !== page.id) return { ok: false, output: "That handle is taken." };
            page.handle = handle;
          }
          if (typeof args.about === "string") page.about = args.about.trim().slice(0, 500) || undefined;
          if (typeof args.category === "string") page.category = args.category.trim().slice(0, 40) || undefined;
          if (typeof args.cta === "string") page.cta = args.cta.trim().slice(0, 40) || undefined;
          if (typeof args.ctaUrl === "string") page.ctaUrl = args.ctaUrl.trim().slice(0, 500) || undefined;
          page.updatedAt = new Date().toISOString();
          await store.updatePage(page);
          return { ok: true, output: `Updated @${page.handle}.` };
        }
        if (action === "setrole" || action === "removerole") {
          if (role !== "admin") return { ok: false, output: "Only a Page admin can manage roles." };
          const botId = String(args.botId ?? "").trim();
          const userId = String(args.userId ?? "").trim();
          if (!botId && !userId) return { ok: false, output: "userId or botId is required." };
          const member = botId ? `bot ${botId}` : userId;
          if (action === "removerole") {
            if (botId) await store.deletePageBotRole(page.id, botId);
            else await store.deletePageRole(page.id, userId);
            return { ok: true, output: `Removed ${member} from @${page.handle}.` };
          }
          const newRole = String(args.role ?? "").trim() as PageRole;
          if (!["admin", "editor", "moderator", "analyst"].includes(newRole)) {
            return { ok: false, output: "role must be admin, editor, moderator, or analyst." };
          }
          if (botId) {
            const bot = await store.getBot(botId);
            if (!bot || bot.userId !== ctx.userId) return { ok: false, output: `No bot ${botId} you own.` };
            await store.setPageBotRole({ pageId: page.id, botId, role: newRole });
          } else {
            await store.setPageRole({ pageId: page.id, userId, role: newRole });
          }
          return { ok: true, output: `Set ${member} as ${newRole} on @${page.handle}.` };
        }
        if (action === "pin" || action === "unpin") {
          if (action === "unpin") {
            await store.setPagePinnedPost(page.id, null);
            return { ok: true, output: `Unpinned the post on @${page.handle}.` };
          }
          const postId = String(args.postId ?? "").trim();
          const post = postId ? await store.getPost(postId) : null;
          if (!post || post.pageId !== page.id) {
            return { ok: false, output: "postId must be a post on this Page." };
          }
          await store.setPagePinnedPost(page.id, postId);
          return { ok: true, output: `Pinned ${postId} on @${page.handle}.` };
        }
        return { ok: false, output: `Unknown action "${action}".` };
      },
    },
    {
      name: "feed.moderate",
      description:
        "Moderate the Feed: action=hide/unhide a comment, delete_post, or report a post. Page moderation needs a Page role. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["hide", "unhide", "delete_post", "report"],
            description: "What to do.",
          },
          commentId: { type: "string", description: "For hide/unhide." },
          postId: { type: "string", description: "For delete_post/report." },
          reason: { type: "string", description: "For report." },
        },
        required: ["action"],
      },
      requiresApproval: true,
      run: async (args) => {
        const action = String(args.action ?? "").trim().toLowerCase();
        if (action === "hide" || action === "unhide") {
          const commentId = String(args.commentId ?? "").trim();
          const comment = commentId ? await store.getPostComment(commentId) : null;
          if (!comment) return { ok: false, output: `No comment ${commentId}.` };
          const post = await store.getPost(comment.postId);
          const page = post?.pageId ? await store.getPage(post.pageId) : null;
          if (!page || !(await canModeratePage(page))) {
            return { ok: false, output: "You can't moderate comments on that post." };
          }
          await store.setCommentHidden(commentId, action === "hide");
          return { ok: true, output: `${action === "hide" ? "Hid" : "Unhid"} comment ${commentId}.` };
        }
        const postId = String(args.postId ?? "").trim();
        const post = postId ? await store.getPost(postId) : null;
        if (!post) return { ok: false, output: `No post ${postId}.` };
        if (action === "report") {
          await store.createReport({
            id: randomUUID(),
            postId,
            reporterId: ctx.userId,
            reason: String(args.reason ?? "").trim().slice(0, 200) || undefined,
            status: "pending",
            createdAt: new Date().toISOString(),
          });
          return { ok: true, output: `Reported ${postId} for review.` };
        }
        if (action === "delete_post") {
          if (post.authorId === ctx.userId) {
            await store.deletePost(ctx.userId, postId);
            return { ok: true, output: `Deleted ${postId}.` };
          }
          const page = post.pageId ? await store.getPage(post.pageId) : null;
          if (page && (await canModeratePage(page))) {
            await store.deletePostById(postId);
            return { ok: true, output: `Deleted ${postId}.` };
          }
          return { ok: false, output: "You can only delete your own posts (or on a Page you moderate)." };
        }
        return { ok: false, output: `Unknown action "${action}".` };
      },
    },
  ];
}
