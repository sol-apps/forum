/// <reference path="../../pb_data/types.d.ts" />

// forum.js — every read and write the board performs.
//
// The collections are superuser-only at the API-rule level, so this module is the
// only way in. Two things it guarantees, and which the route layer relies on:
//
//   1. No returned object ever contains the `author` relation. Readers see a
//      pseudonym and nothing else. The only thing derived from `author` is the
//      boolean `mine`, and that is computed against the caller's own id.
//   2. Every write is attributed. A post cannot be created without an
//      authenticated caller, and that caller's id is stored on the record.
//
// Pseudonymity here is social, not technical: an administrator reading the
// database can attribute any post. The UI says so.

const MAX_BODY = 4000;
const MAX_TITLE = 120;
const PAGE_SIZE = 10;

function clean(value, max) {
  const text = String(value == null ? "" : value).replace(/\r\n/g, "\n");
  // Strip control characters other than newline and tab.
  const stripped = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return stripped.trim().slice(0, max);
}

function cleanHandle(value) {
  return clean(value, 32).replace(/\s+/g, " ");
}

function requireHandle(value) {
  const handle = cleanHandle(value);
  if (handle.length < 2) {
    throw new BadRequestError("Pick a pseudonym of at least 2 characters.");
  }
  return handle;
}

function requireBody(value) {
  const body = clean(value, MAX_BODY);
  if (body.length < 1) {
    throw new BadRequestError("A post needs something in it.");
  }
  return body;
}

function publicThread(rec) {
  return {
    id: rec.id,
    title: rec.getString("title"),
    pseudonym: rec.getString("pseudonym"),
    post_count: rec.getInt("post_count"),
    replies: Math.max(0, rec.getInt("post_count") - 1),
    created: rec.getString("created"),
    last_post_at: rec.getString("last_post_at") || rec.getString("created"),
    last_post_by: rec.getString("last_post_by") || rec.getString("pseudonym"),
  };
}

function publicPost(rec, callerId, index) {
  const deleted = rec.getBool("deleted");
  const author = rec.getString("author");
  return {
    id: rec.id,
    number: index + 1,
    body: deleted ? "" : rec.getString("body"),
    pseudonym: deleted ? "removed" : rec.getString("pseudonym"),
    created: rec.getString("created"),
    deleted: deleted,
    // The only use of `author` on a read path, and it never leaves as an id.
    mine: !deleted && !!callerId && author === callerId,
  };
}

function categoryBySlug(app, slug) {
  const found = app.findRecordsByFilter(
    "categories", "slug = {:slug}", "", 1, 0, { slug: clean(slug, 40) }
  );
  if (!found.length) {
    throw new NotFoundError("No such category.");
  }
  return found[0];
}

function refreshThread(app, threadId) {
  const thread = app.findRecordById("threads", threadId);
  const all = app.findRecordsByFilter(
    "posts", "thread = {:t}", "created", 500, 0, { t: threadId }
  );
  thread.set("post_count", all.length);

  let lastAt = thread.getString("created");
  let lastBy = thread.getString("pseudonym");
  for (let i = all.length - 1; i >= 0; i--) {
    if (!all[i].getBool("deleted")) {
      lastAt = all[i].getString("created");
      lastBy = all[i].getString("pseudonym");
      break;
    }
  }
  thread.set("last_post_at", lastAt);
  thread.set("last_post_by", lastBy);
  app.save(thread);
  return thread;
}

// GET /api/forum/board
function board(app) {
  const cats = app.findRecordsByFilter("categories", "id != ''", "position", 50, 0);
  return {
    categories: cats.map((cat) => {
      const threads = app.findRecordsByFilter(
        "threads", "category = {:c}", "-last_post_at", 500, 0, { c: cat.id }
      );
      let posts = 0;
      threads.forEach((t) => { posts += t.getInt("post_count"); });
      const latest = threads.length ? publicThread(threads[0]) : null;
      return {
        slug: cat.getString("slug"),
        name: cat.getString("name"),
        blurb: cat.getString("blurb"),
        threads: threads.length,
        posts: posts,
        latest: latest,
      };
    }),
  };
}

// GET /api/forum/category/{slug}?page=n
function category(app, slug, page) {
  const cat = categoryBySlug(app, slug);
  const total = app.countRecords("threads", $dbx.hashExp({ category: cat.id }));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
  const threads = app.findRecordsByFilter(
    "threads", "category = {:c}", "-last_post_at", PAGE_SIZE, (current - 1) * PAGE_SIZE,
    { c: cat.id }
  );
  return {
    category: {
      slug: cat.getString("slug"),
      name: cat.getString("name"),
      blurb: cat.getString("blurb"),
    },
    page: current,
    pages: pages,
    total: total,
    threads: threads.map(publicThread),
  };
}

// GET /api/forum/thread/{id}
function thread(app, id, callerId) {
  let rec;
  try {
    rec = app.findRecordById("threads", id);
  } catch (err) {
    throw new NotFoundError("No such thread.");
  }
  const cat = app.findRecordById("categories", rec.getString("category"));
  const posts = app.findRecordsByFilter(
    "posts", "thread = {:t}", "created", 500, 0, { t: rec.id }
  );
  return {
    category: { slug: cat.getString("slug"), name: cat.getString("name") },
    thread: publicThread(rec),
    posts: posts.map((p, i) => publicPost(p, callerId, i)),
  };
}

// POST /api/forum/thread
function createThread(app, callerId, data) {
  const cat = categoryBySlug(app, data.category);
  const title = clean(data.title, MAX_TITLE);
  if (title.length < 3) {
    throw new BadRequestError("Give the topic a title of at least 3 characters.");
  }
  const handle = requireHandle(data.pseudonym);
  const body = requireBody(data.body);

  const threads = app.findCollectionByNameOrId("threads");
  const rec = new Record(threads);
  rec.set("category", cat.id);
  rec.set("title", title);
  rec.set("pseudonym", handle);
  rec.set("author", callerId);
  rec.set("post_count", 0);
  app.save(rec);

  const posts = app.findCollectionByNameOrId("posts");
  const first = new Record(posts);
  first.set("thread", rec.id);
  first.set("body", body);
  first.set("pseudonym", handle);
  first.set("author", callerId);
  first.set("deleted", false);
  app.save(first);

  refreshThread(app, rec.id);
  return { id: rec.id, category: cat.getString("slug") };
}

// POST /api/forum/post
function createPost(app, callerId, data) {
  let threadRec;
  try {
    threadRec = app.findRecordById("threads", String(data.thread || ""));
  } catch (err) {
    throw new NotFoundError("No such thread.");
  }
  const handle = requireHandle(data.pseudonym);
  const body = requireBody(data.body);

  const posts = app.findCollectionByNameOrId("posts");
  const rec = new Record(posts);
  rec.set("thread", threadRec.id);
  rec.set("body", body);
  rec.set("pseudonym", handle);
  rec.set("author", callerId);
  rec.set("deleted", false);
  app.save(rec);

  refreshThread(app, threadRec.id);
  return { id: rec.id, thread: threadRec.id };
}

// POST /api/forum/post/{id}/delete
function deletePost(app, callerId, id) {
  let rec;
  try {
    rec = app.findRecordById("posts", id);
  } catch (err) {
    throw new NotFoundError("No such post.");
  }
  if (!callerId || rec.getString("author") !== callerId) {
    throw new ForbiddenError("You can only delete your own posts.");
  }
  if (rec.getBool("deleted")) {
    return { id: rec.id, deleted: true };
  }
  // Real erasure: the text goes, the row stays so the thread still reads.
  rec.set("body", "");
  rec.set("pseudonym", "removed");
  rec.set("deleted", true);
  app.save(rec);

  refreshThread(app, rec.getString("thread"));
  return { id: rec.id, deleted: true };
}

module.exports = {
  board,
  category,
  thread,
  createThread,
  createPost,
  deletePost,
};
