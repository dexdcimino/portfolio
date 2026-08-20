# Ship Check

Before you tell me a UI change is done, walk this list. Every item is a way a
change looks correct in the file and is wrong on the screen, and every one has
cost a round trip at least once.

Answer each with what you found, not "checked". If an item does not apply, say
so in three words and move on.

## 1. Is something overwriting it in JS?

If you wrote a CSS rule, search the JavaScript for `style.` assignments on that
element. **Inline styles beat stylesheets.** A perfect rule loses silently to
one line of JS set three files away.

Fix the JS if you can reach it. If you cannot, use `!important` and write down
why, so the next person does not quietly remove it.

## 2. Does something later undo it?

If you changed visibility, a class, or a display value, trace what runs **after**
you in the same flow. Name every function that fires between your change and the
next paint, and confirm none of them reset it.

A function called `refresh`, `update` or `apply` anything is the usual culprit.

## 3. Did you fix one branch and leave the other?

Any `if / else` that controls the same feature for two cases — own versus
someone else's, logged in versus out, empty versus populated — has **two**
places to be right. Find every branch, not the one that reproduced the bug.

## 4. How many routes render this?

The same component often appears in several places. List every route, page or
state that renders it, and confirm the fix reaches all of them. Fixing the one
you were looking at is how a bug comes back next week wearing a different URL.

## 5. Will the parent clip it?

If you put something new inside a container with `overflow: hidden` or a
`clip-path`, check it survives. Anything crossing the container's edge — a
badge, a shadow, a tooltip, a focus ring — gets cut off with no warning.

If it will clip, make it a sibling outside the clipped box rather than fighting
the parent.

## 6. Will it collapse the parent?

An absolutely positioned child contributes nothing to its parent's layout. Put
one inside a flex or grid item with no other content and the parent's height
goes to zero, taking everything after it up the page.

## 7. Is that variable actually set yet?

If you referenced a custom property, find where it is defined and confirm that
happens **before** this element paints. A variable set by JS on load is not
available to something rendered during load, and the fallback is what ships.

## 8. Does every path use the same shape?

If you added a wrapper, a container, or a class to one branch that builds this
content, find every other branch that builds the same content and give them the
same shape. Two code paths producing different markup for the same thing is a
bug that only appears on the path nobody tested.

---

## Then

Say which of the eight actually caught something. That is the useful part of
the report — the rest is noise.

If none did, say that too. It is a real answer and it means something.
