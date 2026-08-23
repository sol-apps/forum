/// <reference path="../pb_data/types.d.ts" />

// Schema for the forum: categories, threads and posts.
//
// Every collection here is locked to superusers at the API-rule level (all rules
// null). The browser never talks to /api/collections/* for forum data — it goes
// through the /api/forum/* hook routes, which decide what is safe to return. That
// is what keeps the `author` relation off the wire: it exists on the record, but
// no read path ever projects it.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const categories = new Collection({
    type: "base",
    name: "categories",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "slug", type: "text", required: true, max: 40 },
      { name: "name", type: "text", required: true, max: 60 },
      { name: "blurb", type: "text", required: false, max: 200 },
      { name: "position", type: "number", required: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_categories_slug ON categories (slug)"],
  });
  app.save(categories);

  const threads = new Collection({
    type: "base",
    name: "threads",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "category",
        type: "relation",
        required: true,
        collectionId: categories.id,
        maxSelect: 1,
        cascadeDelete: true,
      },
      { name: "title", type: "text", required: true, min: 3, max: 120 },
      { name: "pseudonym", type: "text", required: true, min: 2, max: 32 },
      // Hidden on every read path. Present so an author can delete their own
      // post, and so an administrator can answer "who actually wrote this".
      {
        name: "author",
        type: "relation",
        required: false,
        collectionId: users.id,
        maxSelect: 1,
        cascadeDelete: false,
      },
      { name: "post_count", type: "number", required: false },
      { name: "last_post_at", type: "text", required: false, max: 40 },
      { name: "last_post_by", type: "text", required: false, max: 32 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_threads_category ON threads (category)",
      "CREATE INDEX idx_threads_last_post ON threads (last_post_at)",
    ],
  });
  app.save(threads);

  const posts = new Collection({
    type: "base",
    name: "posts",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "thread",
        type: "relation",
        required: true,
        collectionId: threads.id,
        maxSelect: 1,
        cascadeDelete: true,
      },
      { name: "body", type: "text", required: false, max: 4000 },
      { name: "pseudonym", type: "text", required: true, min: 2, max: 32 },
      {
        name: "author",
        type: "relation",
        required: false,
        collectionId: users.id,
        maxSelect: 1,
        cascadeDelete: false,
      },
      // Set when an author removes their own post. The body is blanked at the
      // same time, so a deletion is a real erasure and not a hidden flag.
      { name: "deleted", type: "bool", required: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_posts_thread ON posts (thread)",
      "CREATE INDEX idx_posts_created ON posts (created)",
    ],
  });
  app.save(posts);
}, (app) => {
  ["posts", "threads", "categories"].forEach((name) => {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (err) {
      // already gone
    }
  });
});
