import { describe, expect, it } from "vitest";
import { formatReply, linkPlayers } from "@/lib/ask/format";

const mentions = [
  { id: 1, name: "Saka" },
  { id: 2, name: "M.Salah" },
  { id: 3, name: "Gabriel" },
  { id: 4, name: "Gabriel Jesus" },
];

describe("linkPlayers", () => {
  it("links whole names, longest first", () => {
    expect(linkPlayers("Gabriel Jesus over Gabriel, and M.Salah.", mentions)).toEqual([
      { kind: "player", id: 4, text: "Gabriel Jesus" },
      { kind: "text", text: " over " },
      { kind: "player", id: 3, text: "Gabriel" },
      { kind: "text", text: ", and " },
      { kind: "player", id: 2, text: "M.Salah" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves names inside other words alone", () => {
    expect(linkPlayers("Sakamoto", mentions)).toEqual([{ kind: "text", text: "Sakamoto" }]);
  });
});

describe("formatReply", () => {
  it("makes paragraphs, bullet lists and bold", () => {
    const blocks = formatReply("Keep **Saka**.\nHe's fine.\n\n- Sell nobody\n* Captain M.Salah\n1. Roll the transfer\nThat's it.", mentions);
    expect(blocks).toEqual([
      {
        kind: "p",
        parts: [
          { kind: "text", text: "Keep " },
          { kind: "bold", parts: [{ kind: "player", id: 1, text: "Saka" }] },
          { kind: "text", text: ". He's fine." },
        ],
      },
      {
        kind: "list",
        items: [
          [{ kind: "text", text: "Sell nobody" }],
          [
            { kind: "text", text: "Captain " },
            { kind: "player", id: 2, text: "M.Salah" },
          ],
          [{ kind: "text", text: "Roll the transfer" }],
        ],
      },
      { kind: "p", parts: [{ kind: "text", text: "That's it." }] },
    ]);
  });

  it("never passes markup through and drops stray markdown", () => {
    const blocks = formatReply("## Verdict\n<b>hi</b> *maybe*");
    expect(blocks).toEqual([{ kind: "p", parts: [{ kind: "text", text: "Verdict <b>hi</b> maybe" }] }]);
  });
});
