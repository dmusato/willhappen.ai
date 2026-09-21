// The prose pages are converted from their own HTML, which is cheap and exact
// while the markup stays the small set those pages use. These tests are the
// tripwire for the day it stops being that: a block that gets no rule is
// dropped silently, and silently losing a paragraph of /terms is worse than
// failing a build.

import test from "node:test";
import assert from "node:assert/strict";
import { aboutMarkdown, proseMarkdown, termsMarkdown } from "../src/render/markdown.js";
import { aboutBody, termsBody } from "../src/render/pages.js";

test("blocks become their Markdown equivalents", () => {
  const md = proseMarkdown(`
    <h2>A heading</h2>
    <p>A paragraph with <b>bold</b> and <i>italic</i> and a <a href="/x" rel="noopener">link</a>.</p>
    <ul><li>first</li><li>second</li></ul>
  `);
  assert.equal(md, [
    "## A heading",
    "",
    "A paragraph with **bold** and *italic* and a [link](/x).",
    "",
    "- first\n- second",
  ].join("\n"));
});

test("headings keep their words and lose their markup", () => {
  assert.equal(proseMarkdown("<h1>What this is,<br><i>and what it isn't.</i></h1>"),
    "# What this is, and what it isn't.");
});

test("entities are decoded, unknown ones left alone", () => {
  assert.equal(proseMarkdown("<p>Terms &amp; conditions &lt;here&gt; &quot;now&quot;</p>"),
    'Terms & conditions <here> "now"');
  assert.equal(proseMarkdown("<p>&notareal;</p>"), "&notareal;");
});

test("a tag with no rule is dropped, never printed as angle brackets", () => {
  assert.equal(proseMarkdown('<p>text <span class="x">inside</span></p>'), "text inside");
  assert.equal(proseMarkdown("<figure><img src=x></figure>"), "");
});

// Nothing below asserts the prose itself — it asserts that all of it arrived.
for (const [name, body, render] of [
  ["about", aboutBody, aboutMarkdown],
  ["terms", termsBody, termsMarkdown],
]) {
  test(`/${name}.md carries the whole page across`, () => {
    const html = body();
    const md = render("https://willhappen.ai");

    assert.equal(md.match(/<[^>]+>/g), null, "markup leaked into the Markdown");
    assert.equal(md.match(/&[a-z#0-9]+;/gi), null, "an entity was left undecoded");

    // Every section heading and every paragraph in the page has to appear. A
    // count is enough: the only way to lose one is a block this cannot read.
    const headings = (html.match(/<h2\b/gi) || []).length;
    assert.equal((md.match(/^## /gm) || []).length, headings, "a section went missing");

    const paragraphs = (html.match(/<p\b/gi) || []).length;
    const lines = md.split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("-") && l !== "---");
    assert.ok(lines.length >= paragraphs, `${lines.length} blocks of prose for ${paragraphs} paragraphs`);

    assert.ok(md.endsWith(`Canonical: https://willhappen.ai/${name}`));
  });
}

test("/about.md still states the rule the whole site rests on", () => {
  assert.match(aboutMarkdown("https://willhappen.ai"), /No model is ever shown the market price/);
});
