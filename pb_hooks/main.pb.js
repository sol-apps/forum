/// <reference path="../pb_data/types.d.ts" />
/*
 * main.pb.js — server-side hooks for forum. THIS FILE RUNS ON THE SERVER.
 *
 * Runtime is PocketBase 0.39's embedded Goja VM: no npm, no Node APIs, no async.
 *
 * Every route here is a read or write of this app's own collections. There are no
 * outbound calls, no scheduled jobs and no process access, which is what
 * spec.json claims and what CI checks.
 *
 * Handlers run in isolated pooled VMs, so the shared logic lives in
 * pb_hooks/lib/forum.js and is pulled in inside each handler.
 *
 * Reads are open to anyone who can reach the app (it is network-internal).
 * Writes require an authenticated user, and the user's id is stored on the
 * record as `author` — never returned to a reader.
 */

routerAdd("GET", "/api/forum/board", (e) => {
  const forum = require(__hooks + "/lib/forum.js");
  return e.json(200, forum.board(e.app));
});

routerAdd("GET", "/api/forum/category/{slug}", (e) => {
  const forum = require(__hooks + "/lib/forum.js");
  const page = e.request.url.query().get("page");
  return e.json(200, forum.category(e.app, e.request.pathValue("slug"), page));
});

routerAdd("GET", "/api/forum/thread/{id}", (e) => {
  const forum = require(__hooks + "/lib/forum.js");
  const callerId = e.auth ? e.auth.id : "";
  return e.json(200, forum.thread(e.app, e.request.pathValue("id"), callerId));
});

routerAdd("POST", "/api/forum/thread", (e) => {
  const forum = require(__hooks + "/lib/forum.js");
  const body = e.requestInfo().body || {};
  return e.json(200, forum.createThread(e.app, e.auth.id, body));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/forum/post", (e) => {
  const forum = require(__hooks + "/lib/forum.js");
  const body = e.requestInfo().body || {};
  return e.json(200, forum.createPost(e.app, e.auth.id, body));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/forum/post/{id}/delete", (e) => {
  const forum = require(__hooks + "/lib/forum.js");
  return e.json(200, forum.deletePost(e.app, e.auth.id, e.request.pathValue("id")));
}, $apis.requireAuth("users"));
