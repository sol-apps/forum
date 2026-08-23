/// <reference path="../pb_data/types.d.ts" />

// Seed data: the three agreed categories, plus obviously-invented threads so the
// board is not empty on first load. None of these posts has an author relation,
// so nobody can delete them from the UI — they are furniture, not user content.
migrate((app) => {
  const categories = app.findCollectionByNameOrId("categories");
  const threads = app.findCollectionByNameOrId("threads");
  const posts = app.findCollectionByNameOrId("posts");

  const seed = [
    {
      slug: "musings",
      name: "Musings",
      blurb: "Half-formed thoughts, long walks, and things noticed out of the window.",
      position: 1,
      threads: [
        {
          title: "Does anyone else miss the sound of a modem?",
          pseudonym: "dial_up_dan",
          posts: [
            "Sat in a very quiet office this morning and realised the loudest thing I could hear was the kettle. There was a time you could tell how the day was going by the noise the building made.",
            "Genuinely think the handshake noise was load-bearing for my attention span. You knew you had 45 seconds to decide what you actually wanted from the internet.",
            "My contribution to this thread is that I once printed a whole webpage because I was worried it would not be there tomorrow. Reader: it is not there today.",
          ],
          pseudonyms: ["dial_up_dan", "MoominKate", "ferrous_wheel"],
        },
        {
          title: "The best biscuit is structural, not flavourful",
          pseudonym: "ferrous_wheel",
          posts: [
            "A biscuit's job is to survive the journey from tin to mouth via a hot drink. Flavour is a bonus. I will take questions.",
            "Strongly disagree and I am prepared to be unpleasant about it.",
          ],
          pseudonyms: ["ferrous_wheel", "Anonymous Coward"],
        },
      ],
    },
    {
      slug: "technical-chat",
      name: "Technical chat",
      blurb: "Builds, breakages, and the specific way your thing broke at 4pm on a Friday.",
      position: 2,
      threads: [
        {
          title: "What is the smallest useful piece of software you have written?",
          pseudonym: "Ada_of_the_Nine",
          posts: [
            "Mine is eleven lines that renames photos by the date in their metadata. I have used it every week for four years and it has never once been in a sprint.",
            "A shell alias that refuses to let me push to main. It has saved me twice, which is twice more than most of my side projects.",
            "One line of awk I no longer understand. It works. I am afraid of it.",
          ],
          pseudonyms: ["Ada_of_the_Nine", "netsplit", "grep_goblin"],
        },
        {
          title: "Post your worst outage in one sentence",
          pseudonym: "netsplit",
          posts: [
            "The certificate expired on the machine that renews the certificates.",
            "Someone had put the retry logic inside the loop that was already retrying.",
          ],
          pseudonyms: ["netsplit", "grep_goblin"],
        },
      ],
    },
    {
      slug: "meta-greenlight",
      name: "Meta (Greenlight)",
      blurb: "Talk about the platform itself: the review queue, the tiers, and this very forum.",
      position: 3,
      threads: [
        {
          title: "Read this first: what this board is and is not",
          pseudonym: "board_keeper",
          posts: [
            "Ground rules, such as they are. Pick a handle and post. You can delete your own posts, and nobody else's, so think before you press submit.\n\nThis is not an anonymous board. Your account is recorded against every post you make, and an administrator can see it. The handle hides you from other readers, not from the database.",
            "Appreciated. Better to say that out loud than to let people find out later.",
          ],
          pseudonyms: ["board_keeper", "Ada_of_the_Nine"],
        },
        {
          title: "Amber tier for a message board seems about right",
          pseudonym: "MoominKate",
          posts: [
            "Free text about colleagues, plus a hidden link between accounts and handles. Not the end of the world, but not nothing either.",
            "The bit that would worry me is nobody being able to remove someone else's post. That is a moderation gap, not a technical one.",
          ],
          pseudonyms: ["MoominKate", "board_keeper"],
        },
      ],
    },
  ];

  seed.forEach((cat) => {
    const catRec = new Record(categories);
    catRec.set("slug", cat.slug);
    catRec.set("name", cat.name);
    catRec.set("blurb", cat.blurb);
    catRec.set("position", cat.position);
    app.save(catRec);

    cat.threads.forEach((th) => {
      const thRec = new Record(threads);
      thRec.set("category", catRec.id);
      thRec.set("title", th.title);
      thRec.set("pseudonym", th.pseudonym);
      thRec.set("post_count", th.posts.length);
      app.save(thRec);

      let last = "";
      th.posts.forEach((body, i) => {
        const pRec = new Record(posts);
        pRec.set("thread", thRec.id);
        pRec.set("body", body);
        pRec.set("pseudonym", th.pseudonyms[i] || th.pseudonym);
        pRec.set("deleted", false);
        app.save(pRec);
        last = pRec.getString("created");
      });

      thRec.set("last_post_at", last);
      thRec.set("last_post_by", th.pseudonyms[th.posts.length - 1] || th.pseudonym);
      app.save(thRec);
    });
  });
}, (app) => {
  ["posts", "threads", "categories"].forEach((name) => {
    try {
      const recs = app.findAllRecords(name);
      recs.forEach((r) => app.delete(r));
    } catch (err) {
      // collection already gone
    }
  });
});
