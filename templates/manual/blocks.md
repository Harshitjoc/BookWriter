# Blocks

The backlog. One entry per procedure you intend to write, in any order. The `/block`
skill reads this to know what a page is about before it drafts anything. Nothing here
is printed.

Keep the four lines:

- **What** becomes the outcome, in one line.
- **Use when** decides whether the procedure is even worth writing.
- **Action** becomes the box at the bottom.
- **Band** is usually a diagram: a procedure is a flow, and a flow is drawn, not
  photographed.

---

## Part 1 · Wire it up

#### Add a webhook
Integration · diagram
- **What:** stand up an endpoint, verify the signature before trusting the body, then
  confirm with a test delivery that shows as succeeded.
- **Use when:** you need to react to events the moment they happen. **Skip when:** a
  scheduled poll is good enough, because a webhook is more to keep alive.
- **Action:** "Verify the signature before you parse the body."
- **Band:** diagram (provider → verify → reply 200, the reply in green)

---

<!-- Copy the shape above for your own procedures.

#### <Title, a verb>
<Category> · <diagram|photo>
- **What:**
- **Use when:**  ... **Skip when:**
- **Action:**
- **Band:**
-->
