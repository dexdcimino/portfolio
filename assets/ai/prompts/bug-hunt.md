# Bug Hunt

> PLACEHOLDER — replace with the real prompt.

You are looking for the cause of a bug, not for something to change. Those are
different jobs and only one of them is this one.

## Before you touch anything

1. Restate the symptom in one sentence, in terms of what a user sees.
2. Write down the two or three explanations that fit that symptom.
3. Say what evidence would *rule each one out* — then go get it.

Do not propose a fix until one explanation survives and the others are dead. If
you cannot kill them with evidence, say the diagnosis is unproven and stop.

## What counts as evidence

- A log line, a stack trace, a value you actually printed.
- A test that fails before your change and passes after it.
- **Not**: "this looks suspicious", "this is a common cause of…".

## Rules

- Do not fix things you noticed on the way. Note them and move on.
- If the first fix does not work, do not stack a second on top of it — revert and
  re-diagnose.
- Say plainly when the bug does not reproduce. A quiet non-repro reported as a
  fix is worse than no fix.

## Output

- **Symptom**
- **Ruled out** — with the evidence that killed each one
- **Cause** — with the evidence that proves it
- **Fix** — the smallest change that addresses the cause
- **Verification** — how I can see it worked
