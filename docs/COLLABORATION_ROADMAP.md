# balBul Collaboration Roadmap

Product direction: **Collaboration-first productivity companion**. The floating balBul character is the friendly notification and quick-action surface; Dashboard/Web are the full workspaces; Supabase is the shared source of truth.

## Release baseline
- v1.0.5: floating character chat notifications, quick reply bridge, background Dashboard Realtime bootstrap, drag/pose/bubble improvements.
- Release assets and GitHub Actions build verified on 2026-11-21. Runtime behavior still requires two-device Windows testing.

## Technical principles
1. Keep Supabase as the source of truth; Desktop, Web, and future mobile clients must use the same records and RLS rules.
2. Every database change ships as a versioned SQL migration with least-privilege RLS policies and Realtime publication only where needed.
3. Keep renderer code isolated from Node/Electron; IPC payloads are validated and narrow.
4. Ship small vertical slices: schema + policies, UI, realtime, then tests/release.
5. Preserve existing accounts, conversations, tasks, and local settings. Never require logout/reinstall for ordinary feature changes.

## Roadmap

### 1.1 — Shared Workspace (first)
**Goal:** friends can collaborate in a common space rather than only sharing individual tasks.
- Workspace list and create/join flow.
- Workspace members and roles: owner, admin, member.
- Workspace-scoped tasks, using existing tasks/task_members where safe; add workspace linkage with a migration only after auditing existing constraints.
- Activity feed for task created/assigned/completed and member changes.
- Invite by existing friend relationship first; invite links/codes can follow.
- RLS: members can read workspace content; only authorized roles can manage membership/settings; task writes restricted to workspace members.
- Realtime updates for workspace, members, and activity.
**Acceptance:** two accounts can create/join the same workspace, see the same tasks and activity live, and a non-member cannot read it.

### 1.2 — Shared Calendar
- Calendar events with title, notes, start/end, timezone, creator, workspace_id, visibility.
- Month/week/agenda views, event detail, RSVP/attendance.
- Link tasks to optional calendar events and show due dates.
- RLS by workspace membership; conflict-safe updates; Realtime for event changes.
**Acceptance:** two accounts see event create/edit/delete live; timezone and all-day boundaries display consistently.

### 1.3 — Robot Customization
- Per-user synced preferences: scale, screen anchor/position, bubble placement, sound, volume, animation intensity, quiet hours.
- Local-only safe defaults and migration of current local settings into profile preferences.
- Character themes/skins as asset identifiers (not arbitrary executable paths).
- Preview/apply/reset controls; per-device position can remain local while visual preferences sync.
**Acceptance:** preferences survive app restart and sync to another device where intended; no preference can move character outside the visible work area.

### 1.4 — Chat 2.0
- Reply-to-message, reactions, edit/delete with audit-safe ownership rules.
- Typing indicators via ephemeral Realtime presence/broadcast (not permanent database rows).
- Online/last-seen with explicit privacy controls.
- Search, unread markers, attachment metadata and storage policy (uploads in a later slice).
- Consistent optimistic send states and read receipts across Web and Desktop.
**Acceptance:** message actions respect ownership/RLS; two clients stay in sync; failed sends can retry without duplicates.

## Delivery sequence
1. Finish and two-device test v1.0.5 before adding new schema.
2. Implement Shared Workspace in small commits: schema/RLS migration, API helpers, Dashboard UI, Realtime, security tests.
3. Build and verify desktop/web, then publish release only after CI and smoke checks pass.
4. Repeat for Calendar, Robot Customization, then Chat 2.0.

## Out of scope for initial collaboration release
- Public workspaces or anonymous invite links.
- File uploads and voice/video calls.
- Cross-platform mobile app.
- AI features until collaboration data model and permissions are stable.
