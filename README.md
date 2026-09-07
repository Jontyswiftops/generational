# Generational

A private, invite-only round table for mates who want to build wealth and a strong life for their families. Pitch ideas, back each other, talk markets, run a monthly session with a shared whiteboard, and keep each other accountable.

Live at https://jontyswiftops.github.io/generational/

It is a discussion space between mates. Nothing in it is financial advice, and no money ever moves through the app.

## What is in it

- **Table**: a 3D round table (Blender model, Three.js) showing who has a seat and who is online right now. Falls back to a flat list without WebGL.
- **Ideas**: pitch a business, property, shares, crypto or side hustle idea. Mates respond with "I'm in", "Keen to hear more" or "Challenge it", and discuss in threads. Ideas move through Open, In motion, Parked.
- **Sessions**: the host schedules a round table with an agenda and a Google Meet or Zoom link. Members RSVP, then enter the live room: realtime chat, agenda checklist, shared notes, action items. Attendance builds points and a streak.
- **Wins**: post wins, milestones and goals. Reactions, comments, and a "table form" strip.
- **Talk**: five channels (Economy, Property, Shares, Crypto, Business) plus a resource library of books, podcasts, articles and videos.
- **Me**: sign in, display name, password. The host gets the invite code, share link, rename, and member removal.

## Stack

No build step. Vanilla ES modules, vendored Supabase and Three.js, a network-first service worker, GitHub Pages from `main`.

```
index.html  manifest.json  sw.js  css/style.css
js/app.js        hash router, auth lifecycle, invite links
js/cloud.js      Supabase client, every remote call, realtime channels + presence
js/state.js      membership state, presence merge, on-device cache
js/table3d.js    Three.js round table (placeholder geometry, swaps in assets/models/table.glb)
js/views/*.js    home, ideas, sessions, feed, talk, me, shared gates
supabase/schema.sql   reference copy of the database (applied via migrations)
blender/build_table.py reproducible Blender script for the table asset
```

## Setting it up from scratch

1. Create a Supabase project. Put its URL and publishable key in `js/config.js`.
2. Run `supabase/schema.sql` in the SQL editor (or apply it as a migration).
3. Authentication, URL Configuration: set Site URL to `https://jontyswiftops.github.io/generational/` and add it as a redirect URL.
4. Authentication, Email Templates, Magic Link: include `{{ .Token }}` in the body, for example `Your Generational sign-in code: {{ .Token }}`. This is what lets people sign in from the home-screen app on iPhone without being bounced to Safari.
5. Push to GitHub, Settings, Pages: deploy from branch `main`, folder `/ (root)`.
6. Open the app, create your account on the Me screen, press **Claim the host seat**, then share the invite link.

## Running locally

Any static server works. For example:

```bash
npx http-server . -p 8765 -c-1
```

Open http://localhost:8765/. To test two people at once, sign in as one at `localhost` and another at `127.0.0.1` (separate origins, separate sessions).

## Realtime model

Writes go to the database; then the writer sends a tiny broadcast ping (`ideas`, `feed`, `sessions`, `talk`, `resources`) on the `rt-table` channel. Receivers refetch through RPCs so access is always rechecked server-side. Presence on the same channel drives the online dots and the lit seats. Each live session has its own channel (`rt-session-<id>`) for chat, agenda, notes, action and status pings plus room presence.

## Points

Attendance at a finished session 5, idea 3, post 2, comment 1, stance 1, reaction 1. Streak is consecutive finished sessions attended, counting back from the latest.

## Blender asset

`blender/build_table.py` rebuilds the table, rim, base, floor, back wall and whiteboard from scratch and exports `assets/models/table.glb`. Seats stay procedural in Three.js so the ring re-spaces for any member count. Run it from Blender's scripting workspace or via the Blender MCP.
