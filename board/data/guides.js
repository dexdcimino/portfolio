/* Dex Board Work data: guides.
   Source: Mission Control repo dexdcimino/work, api/private.js P.guides.
   Generated at build time. Do not edit by hand. Regenerate with:
   python3 ~/workspace/.dex-board-build/build/generate-work-data.py
   Contact fields are renamed with a detail prefix and are shown
   only inside expandable detail rows on the Work tab. */
export default {
 "guides": [
  {
   "t": "RESUME SYNC · every surface the resume lives on (all AIs)",
   "dex": [
    "Any resume edit = re-sync EVERY surface in RESUME-SURFACES.md (repo root), never just the site.",
    "Canonical: the dexcimino.com resume overlay + the versioned BunnyCDN download PDFs made from it.",
    "Whoever edits the resume tells Dex: these other surfaces need updating too."
   ],
   "ai": "RULE (Oct 20, 2026): a resume edit is not done when the overlay changes ,  it triggers a full propagation pass over RESUME-SURFACES.md (repo root of dexdcimino/work; local master ~/workspace/.resume-audit-oct19/RESUME-SURFACES.md). Canonical source of truth: the dexcimino.com resume + cover overlays (portfolio index.html). The download PDFs are static BunnyCDN files (zone dexcimino-media, assets/about/), filename-versioned via script.js DOCS: on every overlay text edit, regenerate both PDFs, upload under a NEW versioned filename, update the paths (the CDN ignores ?v= query strings ,  never use them), and refresh the ~/workspace/your_files working copies byte-identical. Platforms carrying the resume file or facts: DataAnnotation, Artisan Talent, Bucket of Crabs, Creative Circle, Aquent, Handshake, Mercor, We Are Rosie roster, Upwork, LinkedIn (low priority by Dex’s ruling), Contra (facts only, no file); pending signups ,  Wellfound, Torc, MCJobs, Polycount ,  get created with the current PDF, never an older copy found on disk. Also re-sync: MEMORY.md employment facts, BOTH Digitar archive copies (~/workspace/dex-archive/profile/ + the PRIVATE repo dexdcimino/digitar archive/profile/; never the public portfolio repo), these MC guides, template/packet kits (build-fastcash kits, GPT spec files, .jobmachine packets), the GitHub bio, site Toolkit claims (Blender never appears; the stack is Maya, ZBrush, Substance 3D Painter, Blockbench, Roblox Studio, Unreal, Unity), and any Gmail draft carrying the PDF ,  attachments are snapshots, so check in:drafts has:attachment and re-attach the current your_files PDF before a draft sends. Submitted applications are closed records and are never updated. Whoever edits the resume ,  Dex, Bash or GPT ,  surfaces this list, works the pass, and notifies Dex proactively. Last full sync: Oct 19-20, 2026 (Super League 2023-2025 generation). When the job hunt ends, registry section E is the hide/deactivate list."
  },
  {
   "t": "WAITING · live items that resolve over days (Oct 19, 2026)",
   "dex": [
    "Tempesta/Spindle: CLOSED. The early-access invite landed in spam and was found Oct 22; Dex played Spindle, sent his final review to Marc Cellucci Oct 23 and shelved it. Revisit only for paid help.",
    "Zoud GameLab go/no-go ,  still open (deferred Oct 19; the Oct 26 reminder passed with no decision). Submission deadline Nov 15.",
    "Backer pitch draft review ,  gates ONLY the cold backer emails. Form applications (Indie Fund, Bright Gambit, GameDev.tv) do not wait on it.",
    "Indie Fund gameplay video ,  Dex captures 1-2 minutes from the closed Steam test build. The packet is staged; the ask is $10K (Dex’s call Oct 22; he could nearly finish on $5K). The prototype-access call is also his."
   ],
   "ai": "Live waiting items as of Oct 19, 2026, kept visible so nothing depends on memory; the watches themselves run silently (once-daily Gmail checks) and only landings get surfaced. Tempesta: CLOSED Oct 23 (the invite landed in spam and was found Oct 22; Dex played Spindle and sent Marc Cellucci his final review on Oct 23, then shelved it; revisit only for paid help; the builder-review kit at ~/workspace/your_files/tempesta-builder-review-kit-oct14.md is retained). Zoud: theme Make FinLit Fun, solo OK, IP stays with the entrant; Bash recommendation is GO capped at ~20 build hours with the Nov 4 checkpoint unmoved; lead concept COMPOUND. Backers: pitch approval is the only gate on cold emails; the execution queue (Bright Gambit, GameDev.tv, Verizon courses by Dec 7, Awesome Foundation, CEF email) runs without it. Indie Fund: ask $10,000 (Dex’s call Oct 22, superseding the earlier $20,000 recommendation; he could nearly finish the game on $5K); packet at ~/workspace/.backers-oct18/indie-fund-packet.md."
  },
  {
   "t": "Blockbench correction · Oct 19, 2026 (all AIs)",
   "dex": [
    "Blockbench IS Dex’s tool. Paid Blockbench jobs: Embody Games (current), Lunar, Wynncraft, Mineville, Soul Software.",
    "Scope: Blockbench 3D modeling + texturing for Minecraft primarily; some animating, secondary ,  never inflate it.",
    "The Oct 17-19 never-claim-Blockbench rule was a false inference from a research brief. Dex never said it. It is dead."
   ],
   "ai": "Correction recorded Oct 19, 2026. The false premise gated or skipped real fits: Eternal Creations animator, Varuna modeler, Spawnpoint modeler, the Oreville pitch (sent without claiming a required tool Dex has) and the BuiltByBit strategy. Recovery executed Oct 19: WorldLab Studios 3D Modeler (Blockbench), Eternal Creations Bedrock Animator, Varuna 3D Modeler and Spawnpoint Media Modeler all applied with the Blockbench history stated. No sent email or application ever claimed he lacks Blockbench; the harm was omissions and skips. Going forward, tool facts come from Dex's own statements or his site/resume, verified ,  never inferred from absence in one document. Blender remains NOT his tool (Dex-stated Oct 12, 2026): the site Toolkit lists both, and Dex's direct statements govern over the site list in both directions."
  },
  {
   "t": "Start here · shared context",
   "dex": [
    "Goal 1: first paid dollar ASAP. Nov 4 is a checkpoint, not a deadline.",
    "$1k/mo helps. $5-6k/mo is a win. $100k+ job is excellent.",
    "Remote first. Any format: full-time, contract, freelance, temp.",
    "The long-term job must include AI-assisted building (about half art, half building)."
   ],
   "ai": "Shared context and decisions from Dex's voice conversation: get first income ASAP (Nov 4 is a planning checkpoint, not a bill deadline); $1k/mo helps, $5k-$6k/mo is a meaningful win (gross vs net unconfirmed), $100k+ excellent, $150k+ aspirational. Remote has very high priority; full-time, part-time, freelance, contracts and temp work are all in scope; AI-assisted building is a must in the long-term role (ideal mix ~half art, half AI-assisted building). Also lays out the 5-section structure and the core truthfulness guardrails: Proto Isles is in development (never a released game), ComfyUI/LoRA/Python pipelines are NOT established skills, no outreach to former clients or teammates, and film credits need Dex's factual review."
  },
  {
   "t": "Foundation · ready to show",
   "dex": [
    "Featured area = real work, never UNDER CONSTRUCTION.",
    "Label Proto Isles \"in-development multiplayer sandbox prototype\".",
    "Add availability + contact to the site.",
    "Record 3 clips (20-40s) + 6 screenshots. About 90 minutes.",
    "Confirm resume dates before sending."
   ],
   "ai": "Portfolio and materials prep. Oct 4 portfolio review found the largest featured area is an UNDER CONSTRUCTION panel with placeholder descriptions, underrepresenting existing work; priority fixes include putting real work in the featured area, plainly labeling Proto Isles an in-development multiplayer sandbox prototype, adding availability/contact, curating top work, and hiding the empty COLLAB section. Capture recipe: ~60-90 minutes for three 20-40s slices (gameplay, character/UI customizer, world editor before→edit→after) plus six screenshots ,  commentary optional, no cinematic trailer. Includes a minimal honest project-description template, three application kits (creative technologist/AI builder, 3D/game artist, interactive/web creative), a process-proof example for the Claude Code/Codex workflow, and resume history (Embody 2025-present, Super League 2023-2025, Knights of Edengale 2023-2024, Pyxelchain 2021-2023, led 8 artists) requiring Dex's confirmation."
  },
  {
   "t": "01 · Best-fit opportunities",
   "dex": [
    "Best fit = teams that need an artist's taste AND fast AI-assisted building.",
    "Read the duties, not the title.",
    "Filter: legally eligible → format → honest skill match → still open.",
    "Then rank: fun → proof you have → pay → culture → few meetings.",
    "A real 3D contract beats a fancy AI title you can't show."
   ],
   "ai": "Best-fit targets doctrine. Target profile: teams needing an artist's taste plus AI-assisted building ability (creative software startups, AI game studios, prototyping teams, interactive agencies, demo teams, artist-facing product groups); warns that titles like 'creative technologist' vary wildly, so inspect responsibilities. Lists 8 plausible creative branches as hypotheses to test (AI game prototype creator, product demo/showcase builder, interactive web/brand experiences, creative tool tester, simulation/education, AI-assisted art production, artist tooling, paid creative residency). Ranking rubric: hard filters first (location eligibility, work format, honest skill match, active listing), then enjoyment, proof match, comp, culture, and meeting/engineering load; prefers a genuine 3D contract over an impressive AI title Dex can't demonstrate, with stretch roles kept visible with their gap."
  },
  {
   "t": "02 · Application engine",
   "dex": [
    "Daily: 1-3 dream apps · 5-10 good-fit apps · 2-5 paid-brief replies.",
    "Before sending: still open? eligible? nothing invented?",
    "Engineering-heavy / ML / ComfyUI roles = stretch only.",
    "Track: New → Sent → Reply → Interview → Offer."
   ],
   "ai": "Application engine: volume with a fit floor. Defines search families (art titles, creative-technology titles, adjacent titles) and marks engineering-heavy/ML/ComfyUI/LoRA roles as stretch-only since AI-assisted coding doesn't satisfy independent engineering requirements. Suggests an experimental daily cadence (1-3 priority apps, 5-10 broader suitable apps, 2-5 paid-brief responses) starting with one end-to-end test and a batch of five; pre-submit checks require confirming the listing is open and eligible and never inventing experience, degrees, authorization, salary history, or tool proficiency. Includes a reusable answer bank, AI-use rules for screening assessments (follow employer rules; unaided work is done by Dex), and status definitions from New through Offer."
  },
  {
   "t": "03 · Quick contracts",
   "dex": [
    "Offer A: interactive demo / microsite sprint, one wow interaction, fixed rounds.",
    "Offer B: game-ready art / asset polish package.",
    "Price: $500-1,500 pilot or $50-90/hr. Deposit first. No unlimited revisions.",
    "Count only money actually received."
   ],
   "ai": "Quick contracts: near-term cash while the hiring pipeline develops. Two offers to test first ,  (A) interactive demo/visual microsite sprint with one distinctive interaction and fixed review rounds, (B) game-ready art/asset polish package with defined deliverables ,  plus an alternate narrow creative-workflow-helper offer; explicitly: don't spend week 1 building a new product or brand. Pricing experiments: $500-$1,500 for a tightly bounded pilot or ~$50-90/hr, with warnings about platform fees, taxes, and software costs; no unlimited revisions, agree a paid first milestone or deposit. Lead channels are posted paid briefs, marketplaces, agencies needing overflow, game communities, and startup demo needs ,  never former clients/teammates; includes a compact pitch structure and a 7-step selling strategy (reusable samples, track money actually received)."
  },
  {
   "t": "04 · Proto Isles funding",
   "dex": [
    "Max ~10% of your effort until income is steady.",
    "Grant ≠ publisher ≠ investor ≠ loan. Credits aren't cash.",
    "Need first: one-pager, gameplay clip, playable demo, milestone budget.",
    "Pitch the player experience, not the code."
   ],
   "ai": "Proto Isles funding: a separate long-term branch capped at ~10% of effort until reliable income. Sharply distinguishes funding types ,  grants, publishers (rights/recoupment), investors, loans (never label a loan a grant), and accelerator/credits support (credits are not spendable income). Readiness packet: honest deck/one-pager, strong gameplay clip, playable demo, milestone budget and schedule; historic $5k-$10k funding need is unconfirmed and must be reconfirmed before any ask. Pitch the player experience and a bounded milestone, not system lists or code volume; run eligibility checks (residency, registration, prototype-vs-launched, windows); notes Pitch.com is presentation software, not a game fund."
  },
  {
   "t": "05 · Quick cash ladder",
   "dex": [
    "Climb $100 → $200 → $500 → $1k/month.",
    "Do the next unchecked move every day.",
    "The bar fills from \"$ banked\" on the cash board."
   ],
   "ai": "The ladder is ordered by time-to-first-dollar, then by how much each move also builds long-term proof. Level 1 moves use skills Dex can show today (Roblox thumbnails, unsticking AI-built apps, commission replies, small briefs). Level 2 adds productised offers (AI-assisted, artist-finished 3D characters; interactive stream widgets; Steam capsule art) and starts AI-training applications as a floor. Level 3 is the signature move, the 48-hour playable pitch, plus playable ads and 3D product pages, which pay more and become portfolio. The boss level converts one-off clients to retainers and sells templates of already-shipped apps. Progress is read from cash.dollars; a level shows as cleared when banked money passes its goal."
  },
  {
   "t": "06 · Long-term role strategy",
   "dex": [
    "Aim at Creative Technologist roles at AI creative-tool companies.",
    "Build a 1-day demo with their product for each top-10 target.",
    "Post one work-in-progress thing a day."
   ],
   "ai": "See the Long-term section for the full ranking, the barbell strategy, demo-first applications and the 30-day signals list."
  },
  {
   "t": "Not spam, by design · outreach rubric (all AIs)",
   "dex": [
    "Every message is written for ONE company: a specific true hook about them, in Dex's plain human voice ,  never a copy-paste blast.",
    "Vary subject lines and wording between sends; identical text at volume is what trips filters.",
    "Pace email: spread batches across the day; never dozens of near-identical sends in minutes.",
    "Verified published addresses only. Any opt-out or no is honored immediately and permanently.",
    "Applications on a company's own form are applications, not bulk email ,  normal working pace is fine."
   ],
   "ai": "Standing rule from Dex (Oct 13, 2026) for every AI drafting or sending outreach, pitches, or email applications: the goal is zero spam signals, because this is one person genuinely looking for work. (1) Personalize: each message names something specific and true about that company and reads like Dex wrote it himself ,  plain, brief, human; templates are skeletons only, never sent verbatim twice. (2) No bulk patterns: never fire many near-identical emails in a short window; spread sends out and vary subjects and phrasing. (3) Clean lists: only addresses the company published for contact or hiring; one follow-up maximum, then stop; an opt-out or a no is permanent. (4) Cold email drafts carry a one-line opt-out. The postal-address footer question applies to bulk commercial batches only; Dex decides on send day whether to use a mailbox address ,  never gate drafting or prep on it and never push him to buy one. ATS form applications (Ashby, Greenhouse, Workable) are not email and are not spam-gated; the Ashby spam flag is a bot filter on the browser session, handled by the refill-once protocol or by Dex clicking submit himself."
  },
  {
   "t": "Drafting stance · Oct 17, 2026 (all AIs)",
   "dex": [
    "Drafts now carry more hunger, urgency and directness: lead with breadth and genuine desire for that specific work.",
    "Include the give-me-a-shot energy, and openness to a trial or test build where the target supports it.",
    "In print it reads as hunger, confidence and desire ,  never hardship or pity.",
    "Fortnite experience is zero and is never claimed; Roblox and Minecraft are the proven platforms."
   ],
   "ai": "DRAFTING STANCE ,  Oct 17, 2026 (Dex): He is getting more desperate to land a position ,  his words: I just need a position; I can do so much stuff and this is what I would love to work on. Hold this as drafting context for ALL applications and outreach emails: drafts carry MORE hunger, urgency and directness than before; lead with breadth (he can do a lot ,  3D, 2D, animation, technical + creative, AI-directed building) and genuine desire for that specific company and work; include the give-me-a-shot energy ,  he will not let a chance-giver down ,  and openness to a trial or test build where the target supports it. Printable form is hunger, confidence and desire, never hardship or pity (his standing rule, not revoked). Fortnite/UEFN experience is ZERO ,  never claim it; his transfer is Unreal + Roblox/Minecraft UGC depth, and trial-friendly Fortnite studios are priority targets.\n\nPLATFORM CALIBRATION (same date): For Roblox and Minecraft the claim is stronger and proven ,  extensive 3D modeling for both platforms and some development work; with AI tools he can now build any game a team wants. Never inflate the development side into professional dev tenure. His framing for these platforms: insane drive, loves working with creative teams on imagination platforms, looking for the team and the place to do it. He is explicit that he does NOT want desperate copy ,  weave the feel in: one drive line per draft, desire named for that specific company, and a proof offer (trial/test build) where supported."
  },
  {
   "t": "07 · High-volume sending",
   "dex": [
    "20 sends a session. AI drafts, you approve and send.",
    "Follow up once on day 4."
   ],
   "ai": "See the Sending playbook section: tiers A/B/C, the batch procedure, follow-up rule and daily targets."
  },
  {
   "t": "Using the dashboard · sync & handoff",
   "dex": [
    "Type work anywhere on dexcimino.com.",
    "Padlock → your password opens this private view and editing.",
    "Ticks and cash save to the server. Closing the overlay locks it again.",
    "Switch For Dex / For AI at the top."
   ],
   "ai": "Current version (Oct 2026): Mission Control lives in the dexcimino.com work overlay. The public sees only the showcase half (long-term targets and the watchlist). Unlocking with the padlock password sends a DexAuth token into this page; the server then returns the private half (this text, the ladder, contracts, funding) and Dex's saved progress, and every save is checked against the same token. Closing the overlay locks it and clears the private half from the page. For an AI handoff, unlock, switch to For AI, and copy everything. LEGACY (the earlier ChatGPT-hosted version, kept for reference): Dashboard operating guide for the live ChatGPT-hosted version. Access via the private Site link on phone or computer with the same ChatGPT account; check the save indicator before switching devices, and conflicting edits on two devices keep both versions and ask which to use. Offline HTML export embeds current content/tasks/statuses in one portable file (works without network, saves to that browser's localStorage, does not update the live Site); JSON export is the safest progress backup, and import previews changes, requires confirmation, and merges only selected differing fields. Guides are embedded and editable (edits sync), and 'AI handoff' exports all guides, opportunities, statuses, tasks, and notes so another assistant can continue."
  },
  {
   "t": "Research notes · contracts & funding",
   "dex": [
    "Recheck a listing is open right before you apply.",
    "Funding never counts as monthly income.",
    "Ask a client before using AI tools on their material."
   ],
   "ai": "Research notes for contracts and funding, baseline checked 2026-10-04. Carries forward the decisions (first income ideally within a month, remote first, no former-client/teammate contact, Dex is an AI-directed builder not a conventional engineer, funding never counts as expected monthly income) and the quick-contract strategy. Warns that public page access only verifies the page exists, not that a buyer is still hiring ,  recheck immediately before applying. Contains the researched contract/funding entries with eligibility caveats; AI tools must remain part of his working life but client rules on confidential material must be confirmed first."
  }
 ]
};
