# Prompts — the drop folder

Every `.md` file in here is a prompt shown in **AI LAB → PROMPTS**. The three
present are the real set (Braindump to Batch, Ship Check, Browser Game Spec) —
the earlier PLACEHOLDER files were cleared on 2026-08-19, and these landed the
same day. Each file opens with its own `# Title`; the reading view strips it
(both views show the title in their own furniture) but the download keeps it,
so leave it in the file.

## Adding one

1. Drop the `.md` file in this folder.
2. Add one `<article>` to the Prompts panel in `index.html`:

   ```html
   <article class="pr-card" data-file="assets/ai/prompts/your-file.md"
            data-title="Your Title" data-tag="Writing"
            data-desc="One sentence on what it is for. Shown on hover.">
   </article>
   ```

That is all. The card's excerpt, the byte size, the reading preview and the
download are all read from the file itself at runtime — there is no per-prompt
JavaScript and no list to keep in sync. Delete the file and the card without
touching anything else.

## Notes

- `data-tag` is a free-text pill (Writing, Code, Film, …). It is a label, not a
  filter — nothing groups on it yet.
- **`data-desc` is capped at about 25 words**, 30 at the absolute outside. It is
  what the card shows at rest, in a fixed-height body, and a longer one either
  overflows or forces the type down to a size nobody reads. Say what the prompt
  is FOR; the file's own opening lines are already on the card, on hover.
- The preview renders a deliberately small slice of Markdown: headings, bold,
  italic, inline code, fenced code, lists, tables, block quotes, rules and links.
  Raw HTML in a prompt file is escaped and shown as text, on purpose — these
  files are fetched and injected, so treating them as trusted markup would be a
  standing XSS hole for the sake of formatting nobody needs here.
- Downloads hand over the `.md` byte-for-byte, not the rendered preview; the
  copy button puts the same bytes on the clipboard.
- These files are text and are not touched by the image pipeline.
