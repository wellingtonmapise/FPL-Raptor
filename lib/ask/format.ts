/**
 * Ask Raptor's replies as simple blocks for display: paragraphs and bullet
 * lists, with **bold** and player names (which open the player's card).
 * Deliberately small: no HTML from the model ever reaches the page.
 * Pure functions only, so they're easy to test.
 */

export type Inline = { kind: "text"; text: string } | { kind: "bold"; parts: Inline[] } | { kind: "player"; id: number; text: string };
export type Block = { kind: "p"; parts: Inline[] } | { kind: "list"; items: Inline[][] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits text on player names (longest first, whole words only). */
export function linkPlayers(text: string, mentions: { id: number; name: string }[]): Inline[] {
  const names = [...new Map(mentions.filter((m) => m.name.length >= 3).map((m) => [m.name, m.id]))].sort((a, b) => b[0].length - a[0].length);
  if (!text || names.length === 0) return text ? [{ kind: "text", text }] : [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${names.map(([n]) => escape(n)).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  const ids = new Map(names);
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "player", id: ids.get(m[1])!, text: m[1] });
    last = m.index! + m[1].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function inline(text: string, mentions: { id: number; name: string }[]): Inline[] {
  const out: Inline[] = [];
  const parts = text.split(/\*\*(.+?)\*\*/g); // odd indexes were bold
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) out.push({ kind: "bold", parts: linkPlayers(part, mentions) });
    else out.push(...linkPlayers(part.replace(/(^|\s)\*(?=\S)|(?<=\S)\*(?=\s|$)/g, "$1"), mentions));
  });
  return out;
}

export function formatReply(text: string, mentions: { id: number; name: string }[] = []): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", parts: inline(paragraph.join(" "), mentions) });
    if (list.length) blocks.push({ kind: "list", items: list.map((item) => inline(item, mentions)) });
    paragraph = [];
    list = [];
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim().replace(/^#{1,6}\s+/, ""); // headings read as plain lines
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (bullet) {
      if (paragraph.length) {
        blocks.push({ kind: "p", parts: inline(paragraph.join(" "), mentions) });
        paragraph = [];
      }
      list.push(bullet[1]);
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
