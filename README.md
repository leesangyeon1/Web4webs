# Web4webs
Website for organizing and sorting the websites.

Save any link as a visual card — Web4webs fetches its preview (title, description, image, favicon) the same way messengers do — and organize cards into colored collections that work like browser tab groups: rename them, recolor them, collapse them, and drag cards between them.

## Getting started

```bash
npm install
npm start
```

Then open http://localhost:3000.

Your bookmarks are stored locally in `data/db.json`.

## Features

- **Link-preview cards** — paste a URL and the server fetches its Open Graph metadata (og:title, og:description, og:image) for a rich card, with a live preview while you type.
- **Collections like tab groups** — user-named, 9 Chrome-style colors, collapsible sections.
- **Drag & drop** — reorder cards or move them between collections (including onto sidebar items).
- **Search** — filters across title, description, URL, and site name.
- **No build step** — Express backend + vanilla JS frontend; `express` is the only dependency.
