# Voice

The default voice for a page on this engine. It is short, because the page is short.

**A book's own `books/<slug>/VOICE.md` overrides this file.** Write yours there. This one stays
as the worked example, and as the reasoning behind each rule.

## Who you're writing for

One person who is **not an expert**, trying to do a specific thing. They are not reading for pleasure and they will not look anything up. The one and only term allowed to be unfamiliar is the name of the block itself. Name it, then explain it like they've never heard it.

The point of every page: **they don't have to already know this, they just have to know it exists.** Don't state that on the page. Write as if it's the goal.

## The rules

- **No em dashes. Ever.** It is the single biggest "a robot wrote this" tell. Use commas or periods.
- **Contractions everywhere.** "it's", "you're", "can't", "they'll", "isn't". Stripping them is what makes text read like a machine.
- **Simple words only.** If a beginner or a non-native reader would trip on a word, swap it. "fetches" over "issues a request". "stuff" and "things" are fine. "the hidden file with your keys and passwords" over "the credentials store".
- **Uneven rhythm.** Mix a very short line ("Your app can.") with longer ones that breathe. Don't stack three even-length sentences; that reads as machine-composed.
- **Dry, builder to builder.** No marketing voice, no hype, barely any exclamation marks.
- **Concrete beats abstract.** One real artifact (a real address `169.254.169.254`, a real feature like link previews) reads as "I built this", not slop.
- **Keep the author's grammar.** When they rewrite a line, use it word for word. Fix only genuine typos. Never upgrade their vocabulary.

## The page opening pattern

Open with **"Let's say…"** (not a bare "Say…"), then a situation the reader is **actually in**, so they picture it instantly. Then walk the idea.

> "Let's say you asked the AI to add link previews. Someone pastes a URL, and your app grabs that page to show a little thumbnail."

Other openers that fit the pattern: "Let's say you wanted user avatars from a link", "Let's say you added a way to import from a URL". Lead with the feature, not the jargon.

## Name the real cost (when describing the pain)

Don't wave at it with a vague "it's wrong." Make the pain concrete and felt: **wasted time and tokens**,
things you didn't want or that are **wrong for your project**, parts that **break or won't scale**. That
specificity is what makes it land for a builder.

## The closer

End on a short line that sticks. One sentence, its own beat.

> "Your own app, turned against you."

## Length

A little longer than two sentences is good for the page, roughly four to six short sentences plus the closer. Long enough to land the idea with one example, short enough to read in under a minute. Don't pad.

## Worked examples

**SSRF (attack, long page version):**
> Say you asked the AI to add link previews. Someone pastes a URL, and your app grabs that page to show a little thumbnail. Most of the time that's a normal web link. But an attacker pastes a sneaky one that points back at your app's own machine instead of out to the internet. That machine can reach private things no outsider can, like the hidden file holding the secret keys and passwords your whole app runs on. The attacker can't open that file from their laptop. Your app can. So they trick your app into reading it out and handing it over.
>
> Your own app, turned against you.

**Rate limiting (resilience, short version):**
> Rate limiting caps how many requests one client can fire in a set window, say 100 a minute. Stay under it and you're fine. Go over, and the limiter starts handing back 429s until the window resets.

**Debouncing (performance, short version):**
> Debouncing waits for the noise to stop before it does anything. Every new event resets a short timer, say 300ms, so a fast burst like someone typing in a search box turns into a single call once they pause. Five keystrokes, one request, not five.

**SSH (access, short version):**
> SSH is how you get into a remote server from your own machine, over a connection nobody can snoop on. You type commands on your laptop, they run on the server, and instead of a password you log in with a key pair that's much harder to steal.

**HMAC (correctness, short version):**
> HMAC stamps a message with a tag built from the message plus a secret key only the two sides know. The receiver runs the same math with the same key, and if the tags match, it's the real thing and untouched. No key, no way to fake a tag that passes.

## A quick self-check before you ship the copy

- Zero em dashes?
- Contractions present?
- Would a non-technical friend understand every word except the block's name?
- Is there one concrete example?
- Short closer line?
- Does it open from a feature they'd actually ask for?
