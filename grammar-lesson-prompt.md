Create **one self-contained HTML file** that turns the grammar chapter below into an interactive lesson optimized for **real learning and retention**, not just attractive presentation.

Use only:

- HTML
- embedded CSS
- embedded vanilla JavaScript

Do not use:

- external assets
- frameworks
- libraries
- CDN links
- API calls
- `localStorage` / `sessionStorage` (this file may run inside a sandboxed viewer that blocks browser storage — keep all state in JS variables in memory; state resetting on reload is expected and fine)

Return **only the final HTML file**.

---

## GOAL

Build a lesson that helps the learner **master the grammar point through short, active practice loops**.

Priorities, in order:

1. fast understanding
2. repeated retrieval
3. correction of mistakes
4. visible progress
5. strong retention

This is not a long article with quizzes attached, and not a decorative interactive toy. The learner should interact meaningfully within the first screen. Every visual or motion effect in this spec is subordinate to priorities 1–5 above — if an effect ever makes it harder to read a correction, see a hint, or complete an item, the learning requirement wins.

---

## FIRST: UNDERSTAND THE CHAPTER

Before writing the HTML, infer and use:

- the exact grammar rule from the chapter
- 3 to 5 sub-skills the learner must master
- 2 to 4 common learner mistakes for this grammar point
- whether positive / negative / question forms are actually relevant
- the best examples and exercise patterns from the chapter

Use the chapter as the main source for the rule and examples. For likely learner mistakes, use normal ESL teaching knowledge for this exact topic.

---

## LEARNING DESIGN PRINCIPLES

- **Action before explanation**: let the learner attempt something before showing a long explanation.
- **Retrieval before revelation**: never give away the answer before an attempt.
- **Tight feedback loops**: every answer produces immediate, useful feedback.
- **Wrong answers must teach**: explain why the answer is wrong and what rule to notice.
- **Tiered hints**: guide first, explain later, reveal only on explicit learner request (full system defined once, in HINT SYSTEM below).
- **Scaffold difficulty**: recognition → controlled production → error correction → mixed application.
- **Interleave sub-skills** rather than teaching them in isolated blocks.
- **Re-test missed items later** in the same session.
- **Track sub-skill mastery separately**, not only overall performance.
- **Keep motivation intrinsic** through clarity, interaction, and visible improvement — not fake gamification (no points/streak-fire/confetti-style mechanics).

---

## VISUAL THEME

Match the TOEFL Tracker v2 dashboard aesthetic: calm, focused, academic. Clean surfaces, generous whitespace, restrained teal palette. The topbar uses a dark teal gradient. Cards are white on a cool off-white background. Actions use solid mid-teal. Secondary emphasis uses muted text. Nothing loud or decorative.

- dark teal gradient header (`linear-gradient(135deg, #2c7873, #173f3b)`)
- content on white `#ffffff` surface cards, page background `#f6f7f8`
- subtle alternate surface `#eaf5f3` for inset panels, hints, and active states
- clear separation between layers without harsh contrast
- large rounded cards (`border-radius: 14px`), thin `#e6e8eb` borders, soft drop shadows
- no loud gradients, neon accents, glassmorphism, or gamified styling

Typography: system font stack, base ≥16px. Headings and key values in bold `#1f2937`. Labels, hints, secondary text in `#6b7280`. Hierarchy comes from spacing, weight, and contrast — not bright color.

---

## COLOR / DESIGN SYSTEM

Define these CSS custom properties exactly:

```css
--color-bg:          #f6f7f8;   /* cool off-white page background */
--color-surface:     #ffffff;   /* card surfaces */
--color-surface-alt: #eaf5f3;   /* subtle alternate surface, inset panels, hover states */
--color-header-from: #2c7873;   /* topbar gradient start */
--color-header-to:   #173f3b;   /* topbar gradient end */
--color-primary:     #2a7a7a;   /* mid teal, primary actions */
--color-primary-dark:#1f5f59;   /* hover/pressed state */
--color-accent:      #2c7873;   /* teal-700, secondary emphasis, links */
--color-text:        #1f2937;   /* dark body/heading text */
--color-text-muted:  #6b7280;   /* secondary muted text */
--color-text-faint:  #9ca3af;   /* tertiary / placeholder */
--color-border:      #e6e8eb;   /* thin light borders */
--color-success:     #16a34a;   /* muted green correct state */
--color-success-bg:  #e7f7ec;   /* green tint surface */
--color-error:       #dc2626;   /* soft red incorrect state */
--color-error-bg:    #fdeaea;   /* red tint surface */
--color-warning:     #b45309;   /* muted amber */
--color-warning-bg:  #fef3e2;   /* amber tint surface */
--shadow-soft:       0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.05);
--radius-lg:         14px;
--radius-md:         9px;
--radius-sm:         6px;
```

The header/topbar element uses:
```css
background: linear-gradient(135deg, var(--color-header-from), var(--color-header-to));
```

Primary action buttons:
```css
background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
color: #ffffff;
border: none;
border-radius: 8px;
font-weight: 600;
```

Active/selected tab state:
```css
background: var(--color-surface-alt);
color: var(--color-accent);
border-color: var(--color-accent);
```

Requirements:

- Body text must meet **at least 4.5:1 contrast** against its background (WCAG AA); large headings at least 3:1.
- Correct/incorrect states must be distinguishable by more than color: use icon + label + border style in addition to color.

---

## LAYOUT STYLE

- clear content width and stable grid; sections feel like connected lesson modules, not random stacked cards
- large rounded panels (`border-radius: 14px`, `box-shadow: var(--shadow-soft)`) for concept blocks, practice blocks, mastery summaries, results
- practice cards denser and more task-oriented than intro/explanation cards
- **Desktop (≥900px):** sticky instructional panel (where used) sits beside flowing explanation/practice content, two-column.
- **Tablet (600–899px):** single column; sticky panel becomes a collapsible block anchored above the related content instead of beside it.
- **Mobile (<600px):** single column, full-width cards, minimum 16px body text, minimum 44px tap targets, no horizontal scrolling, no large empty gaps between stacked cards.

Avoid: card soup, oversized decorative hero areas, sharp black-on-white harshness, dense enterprise-dashboard clutter.

---

## LESSON STRUCTURE

One continuous vertical page. These seven sections are a **fixed backbone** — always include all seven, in this order, and don't add extra top-level sections. What flexes with chapter complexity is _item count and depth within_ a section, not the section list itself.

1. **Immediate start** — lesson title, one-sentence subtitle, first interactive question appears immediately. After the learner's first attempt, reveal the core rule in plain English.
2. **Core decision rule** — interactive concept panel teaching the main rule as a decision model (categories, contrast, or sorting logic) that helps the learner decide which form to use.
3. **Key contrasts / tricky distinctions** — 3 to 5 items on easily confused pairs. Learner chooses before seeing the explanation.
4. **Common mistakes** — 3 to 4 items: wrong sentence → learner fixes it → explanation. Use realistic ESL errors.
5. **Mixed practice** — 8 to 10 interleaved items across sub-skills, including 2 to 3 re-tests of items missed earlier in the session.
6. **Final quiz** — 6 to 8 harder questions, mixed sub-skills, **no hints available** (see INTERACTION TYPES for this exception).
7. **Results** — performance by sub-skill, weakest area identified, one sentence of review advice, restart button that resets all state and scrolls to top.

---

## INTERACTION TYPES

Use a small, high-value set: multiple choice, fill in the blank, error correction, categorization/sorting, and short sentence building where appropriate. Don't overload the lesson with more than these.

Every interaction in sections 1–5 must:

- require an attempt before evaluation
- support the tiered hint system (see HINT SYSTEM)
- show immediate feedback
- update sub-skill mastery

**Exception:** the Final Quiz (section 6) has no hint control at all — this is intentional and overrides the "every interaction supports hints" rule above for that section only.

---

## PRACTICE BEHAVIOR

Flow is always **attempt → feedback → retry**, never attempt → auto-answer.

- Every item requires an explicit attempt before evaluation.
- The correct answer is never revealed automatically — not after a wrong attempt, repeated wrong attempts, inactivity, scrolling, time passing, adaptive branching, or leaving and returning to the item. The only path to seeing the answer is the learner-driven Hint control (see HINT SYSTEM).
- After a wrong answer: show a clear incorrect state, a short rule-based correction, the reason tied to the grammar point, and a chance to retry.
- The correction/explanation stays visible and in place under the question — it does not collapse, vanish, or get replaced — until the learner changes their answer and resubmits, moves to the next item, or explicitly dismisses it.
- If the learner gets it right after a previous miss, briefly acknowledge the recovery and keep the explanation visible long enough to read.
- If the answer was revealed via Hint, visually mark it as learner-requested help, not independently solved.

---

## HINT SYSTEM

One Hint control per item, fully learner-controlled, advancing through stages on click:

1. **First click:** guiding nudge or question.
2. **Second click:** stronger clue.
3. **Third click:** full explanation, and — only at this final stage — the correct answer.

Rules:

- Never jump straight to the answer; never reveal it without this explicit progression.
- Do not add a separate "Show answer" button.
- If the answer is revealed at stage 3, keep the rule explanation shown underneath it — never replace the explanation with just "Correct answer: X."
- Not available in the Final Quiz (see INTERACTION TYPES).

---

## ADAPTIVE LOGIC

Simple, authored adaptivity in JS:

- **2 wrong in a row** on the same sub-skill → insert one easier scaffolded item soon after, with a visible note like "Let's try a simpler version of this."
- **2 correct quickly in a row** on the same sub-skill → skip one remaining easy item for that sub-skill, with a visible note like "You've got this — moving to a harder one."
- **Missed item** → goes into a review queue and reappears after at least 2 other items.

Adaptivity may insert support items or skip easy ones — it must never force-reveal an answer, and it must stay simple and robust enough that the learner can perceive it happening.

---

## HEADER PINNING (mandatory)

The header (lesson title + thin page-progress bar) uses `position: sticky; top: 0` (or `fixed` with a matching content offset) and stays pinned at the top of the viewport for the entire page, at constant height, above all content in stacking order. It never scrolls away, never gets covered, and never resizes based on content, active section, or adaptive insertions. Only the content below it scrolls.

Reveal lower sections with `IntersectionObserver` (simple fade/slide-in on entry is fine). Respect `prefers-reduced-motion`. Never hijack scrolling, block downward/upward movement, or alter native scroll speed. No opacity/blur/saturation-based "focus" effect on sections that are off-screen or already scrolled past — sections should simply be at full, consistent visibility whenever they're in the DOM and in view. Keep scroll-triggered motion to that one entry animation; nothing else should change appearance based on scroll position.

---

## VISUAL / UX REQUIREMENTS

- system font stack, base font size ≥16px, clear heading hierarchy
- headings in bold `#1f2937`, helper/secondary text in `#6b7280`, placeholder/faint text in `#9ca3af`
- generous but not excessive spacing; practice zones denser than intro/explanation zones
- explanation, example, question, hint, correct feedback, and incorrect feedback must all be visually distinct from each other at a glance
- correct state: green left border + `#e7f7ec` background + ✓ icon + text label
- incorrect state: red left border + `#fdeaea` background + ✗ icon + rule-based text
- hint panel: `#eaf5f3` background + `#2a7a7a` left border, clearly separate from feedback
- progress bar in header: thin (4px), fills left-to-right, teal fill on `#e6e8eb` track

---

## ACCESSIBILITY / TECHNICAL REQUIREMENTS

- semantic HTML; all important text exists in the HTML itself, not only injected later; page still reads sensibly with JavaScript disabled
- keyboard-accessible controls with visible focus states (outline: `2px solid #2a7a7a`, offset: 2px)
- `aria-live="polite"` region for feedback
- wrap JS to avoid global namespace pollution
- no browser storage (in-memory JS state only)
- standalone file, no build step

---

## BEFORE RETURNING THE FILE

Mentally trace the state machines once before finalizing — these are the parts most likely to have silent bugs:

- Does a missed item actually reappear after exactly 2+ other items, and does the review queue correctly interleave with new items in Mixed Practice?
- Does the 2-wrong / 2-correct streak logic reset correctly per sub-skill, and does it never trigger inside the Final Quiz?
- Does dismissing a hint-revealed explanation vs. a wrong-answer explanation both behave per PRACTICE BEHAVIOR?

Then confirm:

- [ ] header stays pinned for the entire scroll length
- [ ] learner interacts within the first screen or two
- [ ] core rule is taught through action first, not text first
- [ ] hints are tiered and only the final stage reveals the answer
- [ ] wrong answers get rule-based explanations that persist until dismissed/resubmitted/advanced
- [ ] no answer is ever auto-revealed, anywhere, for any reason
- [ ] missed items return later in the same session
- [ ] sub-skill mastery is tracked and shown separately in Results
- [ ] adaptivity is simple but the learner can feel it
- [ ] motion effects fully disable under `prefers-reduced-motion`
- [ ] no section's appearance changes based on scroll position — sections are simply visible once in view
- [ ] page reads sensibly with JS off
- [ ] visual design matches the TOEFL Tracker v2 dashboard aesthetic with the exact CSS values above

---

## OUTPUT RULE

Return **only the final HTML file** and nothing else — no preamble, no commentary, no markdown code fences around it.

---

## GRAMMAR CHAPTER

[PASTE CHAPTER HERE]
