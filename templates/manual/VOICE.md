# Voice — set up your server

This is the voice for a book someone follows, one step at a time, probably with a
terminal open and something already half-broken. The `/block` skill reads this file
before it writes a word. If you copy this template, rewrite it in your own voice.

## Who you are writing for

An operator under pressure, following the page in order for the first time. They will
do exactly what the steps say. If a step is ambiguous, they will guess wrong and blame
themselves. Your job is to leave no room for the wrong guess.

## The rules

- **The title is a verb.** "Add a webhook", not "Webhooks". The reader is doing
  something, not studying a topic.
- **No em dashes.** Commas and full stops.
- **Contractions are fine.** "don't", "it's", "you'll see".
- **One action per step.** If a step has "and then", it is two steps.
- **Say where they are.** "the provider's dashboard", "the raw body", "the header".
  Name the thing, don't gesture at it.
- **The last step is the proof.** The reader finishes with the exact thing they see
  when it worked. A procedure with no confirmation is a procedure nobody trusts.
- **Never invent a menu, a flag, or an endpoint.** If you have not done it, do not
  write the step. A made-up step is worse than a missing one.

## The opening

No opening paragraph. In a procedure the numbered list is the whole explainer, and
step one comes immediately after the rule. The reader started at the title.

## The middle

Order is the content. Each step assumes the one before it happened. Commands and
paths go in <code>. Use the colour roles: blue for the thing you change, green for the
confirmation, red for the step that breaks things if skipped.

## The closer

A procedure ends on the proof, not a moral. The final numbered step is the closer.

## The action box

Label it as the first move: DO THIS FIRST, BEFORE YOU START, CHECK FIRST. It holds the
one step that ruins the rest if it is skipped or done wrong.
