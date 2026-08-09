/**
 * Reading and writing the Daggerheart character sheet's **connections** field.
 *
 * That field (`system.biography.connections`) is a single HTML blob, not a list.
 * So questions have no ids and no structure of their own; they are recognised by
 * shape and addressed by ordinal position.
 *
 * ## Two shapes, not one
 *
 * The blob exists in two forms, and code here must handle both.
 *
 * As the **system writes it** at character creation, the prompts are joined by
 * bare `<br/>` separators (see the class item's `_preCreate`):
 *
 * ```html
 * <p><strong>What animal do I say you remind me of?</strong></p><br/>
 * <p><strong>What affectionate nickname have you given me?</strong></p>
 * ```
 *
 * Once the field has been through the sheet's ProseMirror editor **even once**,
 * those separators are normalized into empty paragraphs:
 *
 * ```html
 * <p><strong>What animal do I say you remind me of?</strong></p>
 * <p><br></p>
 * ```
 *
 * The second form has a usable answer slot; the first does not. A `<br>` is a
 * *separator*, not a container — it is a void element, so writing into it is
 * silently discarded by the DOM. `answerSlot()` therefore only ever accepts an
 * element that can actually hold children, and `writeConnectionAnswer()` inserts
 * a paragraph when there is no such slot.
 *
 * ## Why the parsing is deliberately conservative
 *
 * The player's own editor can rewrite this blob at any time, and it holds prose
 * we did not author. Every function here therefore edits in place and
 * re-serializes the *whole* document: anything unrecognised is passed through
 * untouched rather than normalized, dropped, or reformatted. We would rather miss
 * a question than eat someone's writing.
 *
 * Pure DOM work — no Foundry APIs — so it can be reasoned about (and fixed) on
 * its own.
 */

/** One connection question found in the blob, with whatever answer it carries. */
export interface ParsedConnection {
  /** Ordinal position among the questions found, and how a question is addressed. */
  index: number;
  question: string;
  /** Plain text of the answer slot; empty when the question is unanswered. */
  answer: string;
}

/**
 * The questions in a connections blob, in document order.
 *
 * A paragraph counts as a question when *all* of its text is bold — that is the
 * shape character creation produces, and it is what distinguishes a prompt from
 * an answer written underneath it.
 */
export function parseConnections(html: string): ParsedConnection[] {
  const body = parseBody(html);
  const found: ParsedConnection[] = [];

  for (const element of blocks(body)) {
    const question = questionText(element);
    if (question === null) continue;
    found.push({
      index: found.length,
      question,
      answer: textOf(answerSlot(element)),
    });
  }

  return found;
}

/**
 * Write an answer into the slot beneath question `index`, returning the new blob.
 *
 * Returns `null` when the question no longer exists — the sheet was edited out
 * from under us, and guessing at a different slot would put the answer in the
 * wrong place.
 *
 * The answer is credited inline (`<em>Kira:</em> …`) because a connection is as
 * much about *who* it is with as what was said, and the sheet is where it will be
 * read back.
 */
export function writeConnectionAnswer(
  html: string,
  index: number,
  answererName: string,
  answer: string,
): string | null {
  const body = parseBody(html);

  let seen = -1;
  for (const element of blocks(body)) {
    if (questionText(element) === null) continue;
    if (++seen !== index) continue;

    // Reuse the blank paragraph creation left behind; only add one when the
    // question has no usable slot — it ends the blob, or the system's own
    // `<br/>` separator sits where a slot would be.
    let slot = answerSlot(element);
    if (!slot) {
      slot = body.ownerDocument.createElement("p");
      element.after(slot);
    }
    slot.innerHTML = `<em>${escape(answererName)}:</em> ${paragraphize(answer)}`;

    // Confirm the answer survived serialization before reporting success. A slot
    // that silently discards its children (this is exactly how the `<br>` bug
    // hid) must surface as a failure, not as a write that changed nothing.
    const written = body.innerHTML;
    return parseConnections(written)[index]?.answer.trim() === "" ? null : written;
  }

  return null;
}

/**
 * Strip every answer, leaving the questions and their (now blank) slots.
 *
 * Backs the GM's "reset the round" control, so a table can redo connections
 * without hand-clearing each sheet.
 */
export function clearConnectionAnswers(html: string): string {
  const body = parseBody(html);
  for (const element of blocks(body)) {
    if (questionText(element) === null) continue;
    const slot = answerSlot(element);
    if (slot) slot.innerHTML = "<br>";
  }
  return body.innerHTML;
}

// --- internals --------------------------------------------------------------

function parseBody(html: string): HTMLElement {
  return new DOMParser().parseFromString(html ?? "", "text/html").body;
}

/** Top-level block elements, which is the only level the blob ever nests to. */
function blocks(body: HTMLElement): Element[] {
  return [...body.children];
}

/**
 * The question this paragraph asks, or `null` if it isn't one.
 *
 * The test is that the element's bold text accounts for *all* of its text: a
 * paragraph that is entirely bold is a prompt, whereas an answer containing a
 * bolded word or two is not. Whitespace is collapsed before comparing so that
 * editor-inserted line breaks inside the `<strong>` don't defeat the match.
 */
function questionText(element: Element): string | null {
  const text = collapse(element.textContent);
  if (text === "") return null;
  const bold = collapse(
    [...element.querySelectorAll("strong, b")].map((el) => el.textContent ?? "").join(" "),
  );
  return bold !== "" && bold === text ? text : null;
}

/**
 * Void elements, which cannot be answer slots.
 *
 * The DOM accepts `element.innerHTML = "..."` on these and then drops it on
 * serialization, so treating a `<br>` separator as a slot loses the answer with
 * no error anywhere. Keep this list rather than trusting the write to fail.
 */
const VOID_ELEMENTS = new Set([
  "AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT",
  "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR",
]);

/**
 * The element holding (or waiting to hold) this question's answer: the next
 * block that is neither another question nor a void separator.
 *
 * `null` means there is nowhere to put an answer yet — the question ends the
 * blob, is followed directly by the next question, or is separated from it by a
 * bare `<br/>`. The caller creates a paragraph in that case.
 */
function answerSlot(question: Element): Element | null {
  const next = question.nextElementSibling;
  if (!next) return null;
  if (VOID_ELEMENTS.has(next.tagName)) return null;
  if (questionText(next) !== null) return null;
  return next;
}

/** Visible text of a slot — a lone `<br>` placeholder reads as empty. */
function textOf(slot: Element | null): string {
  return slot ? collapse(slot.textContent) : "";
}

function collapse(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape an answer and keep the player's own line breaks. */
function paragraphize(answer: string): string {
  return escape(answer.trim()).replace(/\r?\n/g, "<br>");
}
