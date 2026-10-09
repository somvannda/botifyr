import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * Groups are communities with their own post stream: creating a group makes the
 * owner an admin member, posting to a group requires membership, and a group feed
 * returns its posts.
 */
describe("groups", () => {
  async function setup() {
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();
    const signUp = async (email: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "password123" },
      });
      expect(response.statusCode).toBe(201);
      return response.json() as { token: string; user: { id: string } };
    };
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    return { app, store, signUp, auth };
  }

  it("creates a group, gates posting on membership, and serves a group feed", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-group@example.com");
    const bob = await signUp("bob-group@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth(alice.token),
      payload: { name: "Bird Watchers" },
    });
    expect(created.statusCode).toBe(201);
    const group = created.json() as { id: string; handle: string; members: number; joined: boolean };
    expect(group.handle).toBe("birdwatchers");
    expect(group.members).toBe(1);
    expect(group.joined).toBe(true);

    // A non-member can't post to the group.
    const denied = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(bob.token),
      payload: { body: "hi group", groupId: group.id },
    });
    expect(denied.statusCode).toBe(403);

    // Bob joins, then can post.
    const join = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/join`,
      headers: auth(bob.token),
      payload: {},
    });
    expect(join.statusCode).toBe(200);
    const post = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(bob.token),
      payload: { body: "hi group", groupId: group.id },
    });
    expect(post.statusCode).toBe(201);

    const feed = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.handle}/posts`,
      headers: auth(alice.token),
    });
    expect(feed.statusCode).toBe(200);
    expect((feed.json() as Array<{ body: string }>).map((entry) => entry.body)).toContain("hi group");

    const mine = await app.inject({ method: "GET", url: "/v1/groups", headers: auth(bob.token) });
    expect((mine.json() as Array<{ id: string }>).map((entry) => entry.id)).toContain(group.id);

    await app.close();
  });

  it("discovers public groups and hides private ones from discovery", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-discover@example.com");
    const bob = await signUp("bob-discover@example.com");

    await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth(alice.token),
      payload: { name: "Public Birders", category: "Nature", privacy: "public" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth(alice.token),
      payload: { name: "Secret Society", category: "Nature", privacy: "private" },
    });

    const discover = await app.inject({
      method: "GET",
      url: "/v1/groups/discover",
      headers: auth(bob.token),
    });
    expect(discover.statusCode).toBe(200);
    const names = (discover.json() as Array<{ name: string; privacy: string }>).map((entry) => entry.name);
    expect(names).toContain("Public Birders");
    expect(names).not.toContain("Secret Society");

    // Search + category filters narrow the result set.
    const filtered = await app.inject({
      method: "GET",
      url: "/v1/groups/discover?q=secret",
      headers: auth(bob.token),
    });
    expect((filtered.json() as unknown[]).length).toBe(0);

    const categories = await app.inject({
      method: "GET",
      url: "/v1/groups/categories",
      headers: auth(bob.token),
    });
    expect((categories.json() as { categories: string[] }).categories).toContain("Nature");

    await app.close();
  });

  it("gates private groups behind an approved join request", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-private@example.com");
    const bob = await signUp("bob-private@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth(alice.token),
      payload: { name: "Private Club", privacy: "private" },
    });
    const group = created.json() as { id: string; handle: string };

    // Requesting to join a private group always lands as a pending request.
    const join = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/join`,
      headers: auth(bob.token),
      payload: {},
    });
    expect(join.statusCode).toBe(200);
    expect((join.json() as { status: string }).status).toBe("pending");

    const read = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.handle}`,
      headers: auth(bob.token),
    });
    const detail = read.json() as { joined: boolean; requestPending: boolean; privacy: string };
    expect(detail.joined).toBe(false);
    expect(detail.requestPending).toBe(true);

    // A non-member can't read the private stream or the member list.
    const denied = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.handle}/posts`,
      headers: auth(bob.token),
    });
    expect(denied.statusCode).toBe(403);

    // Only admins can see and resolve requests.
    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/requests`,
      headers: auth(bob.token),
    });
    expect(forbidden.statusCode).toBe(403);

    const requests = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/requests`,
      headers: auth(alice.token),
    });
    expect(requests.statusCode).toBe(200);
    expect((requests.json() as Array<{ userId: string }>).map((entry) => entry.userId)).toContain(
      bob.user.id,
    );

    const approve = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/requests/${bob.user.id}`,
      headers: auth(alice.token),
      payload: { action: "approve" },
    });
    expect(approve.statusCode).toBe(200);

    const nowMember = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.handle}/posts`,
      headers: auth(bob.token),
    });
    expect(nowMember.statusCode).toBe(200);

    await app.close();
  });

  it("enforces owner/admin/moderator permissions", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-roles@example.com");
    const bob = await signUp("bob-roles@example.com");
    const carol = await signUp("carol-roles@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth(alice.token),
      payload: { name: "Role Testers" },
    });
    const group = created.json() as { id: string; handle: string };

    for (const token of [bob.token, carol.token]) {
      await app.inject({
        method: "POST",
        url: `/v1/groups/${group.id}/join`,
        headers: auth(token),
        payload: {},
      });
    }

    // A plain member can't edit the group or manage members.
    const editDenied = await app.inject({
      method: "PATCH",
      url: `/v1/groups/${group.id}`,
      headers: auth(bob.token),
      payload: { about: "hijacked" },
    });
    expect(editDenied.statusCode).toBe(403);
    const membersDenied = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/members`,
      headers: auth(bob.token),
    });
    expect(membersDenied.statusCode).toBe(200); // public group: members are visible
    const removeDenied = await app.inject({
      method: "DELETE",
      url: `/v1/groups/${group.id}/members/${carol.user.id}`,
      headers: auth(bob.token),
    });
    expect(removeDenied.statusCode).toBe(403);

    // The owner edits successfully and lists the owner as an admin member.
    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/groups/${group.id}`,
      headers: auth(alice.token),
      payload: { about: "A place to test roles", category: "Tech" },
    });
    expect(edited.statusCode).toBe(200);
    expect((edited.json() as { about: string }).about).toBe("A place to test roles");

    const members = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/members`,
      headers: auth(alice.token),
    });
    const list = members.json() as Array<{ userId: string; role: string; owner: boolean }>;
    expect(list.find((entry) => entry.userId === alice.user.id)?.owner).toBe(true);

    // Promote Bob to moderator, then he can moderate posts.
    await app.inject({
      method: "PUT",
      url: `/v1/groups/${group.id}/members/${bob.user.id}`,
      headers: auth(alice.token),
      payload: { role: "moderator" },
    });
    const carolPost = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(carol.token),
      payload: { body: "spam", groupId: group.id },
    });
    const postId = (carolPost.json() as { id: string }).id;
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/posts/${postId}`,
      headers: auth(bob.token),
    });
    expect(removed.statusCode).toBe(204);

    // Moderators manage content, not membership: Bob still can't remove Carol.
    const kick = await app.inject({
      method: "DELETE",
      url: `/v1/groups/${group.id}/members/${carol.user.id}`,
      headers: auth(bob.token),
    });
    expect(kick.statusCode).toBe(403);

    // The owner can remove a member.
    const ownerKick = await app.inject({
      method: "DELETE",
      url: `/v1/groups/${group.id}/members/${carol.user.id}`,
      headers: auth(alice.token),
    });
    expect(ownerKick.statusCode).toBe(204);

    await app.close();
  });

  it("supports inviting members, leaving, and rejecting then re-requesting", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-invite@example.com");
    const bob = await signUp("bob-invite@example.com");
    const carol = await signUp("carol-invite@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth(alice.token),
      payload: { name: "Invite Place", privacy: "private" },
    });
    const group = created.json() as { id: string; handle: string };
    expect(created.statusCode).toBe(201);

    // The owner invites Bob directly.
    const invite = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/invite`,
      headers: auth(alice.token),
      payload: { userId: bob.user.id },
    });
    expect(invite.statusCode).toBe(200);
    const bobDetail = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.handle}`,
      headers: auth(bob.token),
    });
    expect((bobDetail.json() as { joined: boolean }).joined).toBe(true);

    // A member can leave, after which the stream is closed to them again.
    const leave = await app.inject({
      method: "DELETE",
      url: `/v1/groups/${group.id}/join`,
      headers: auth(bob.token),
    });
    expect(leave.statusCode).toBe(204);
    const afterLeave = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.handle}/posts`,
      headers: auth(bob.token),
    });
    expect(afterLeave.statusCode).toBe(403);

    // The owner of a group cannot leave.
    const ownerLeave = await app.inject({
      method: "DELETE",
      url: `/v1/groups/${group.id}/join`,
      headers: auth(alice.token),
    });
    expect(ownerLeave.statusCode).toBe(400);

    // Carol requests, is rejected, and may request again.
    await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/join`,
      headers: auth(carol.token),
      payload: {},
    });
    const reject = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/requests/${carol.user.id}`,
      headers: auth(alice.token),
      payload: { action: "reject" },
    });
    expect(reject.statusCode).toBe(200);
    const reRequest = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/join`,
      headers: auth(carol.token),
      payload: {},
    });
    expect(reRequest.statusCode).toBe(200);
    expect((reRequest.json() as { status: string }).status).toBe("pending");

    await app.close();
  });
});
