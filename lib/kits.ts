/**
 * Shirt colours for the pitch view: plain shirts in each club's colours (no
 * badges or sponsors). Keyed by FPL's three-letter short name, with a few
 * likely promoted clubs too; anything unknown gets a neutral shirt.
 */

export type KitPattern = "solid" | "stripes" | "sleeves" | "halves";
export type Kit = { body: string; trim: string; pattern: KitPattern };

const KITS: Record<string, Kit> = {
  ARS: { body: "#DB0007", trim: "#FFFFFF", pattern: "sleeves" },
  AVL: { body: "#670E36", trim: "#95BFE5", pattern: "sleeves" },
  BOU: { body: "#DA291C", trim: "#111111", pattern: "stripes" },
  BRE: { body: "#E30613", trim: "#FFFFFF", pattern: "stripes" },
  BHA: { body: "#0057B8", trim: "#FFFFFF", pattern: "stripes" },
  BUR: { body: "#6C1D45", trim: "#99D6EA", pattern: "sleeves" },
  CHE: { body: "#034694", trim: "#FFFFFF", pattern: "solid" },
  CRY: { body: "#1B458F", trim: "#C4122E", pattern: "halves" },
  EVE: { body: "#003399", trim: "#FFFFFF", pattern: "solid" },
  FUL: { body: "#FFFFFF", trim: "#111111", pattern: "solid" },
  IPS: { body: "#0044A9", trim: "#FFFFFF", pattern: "solid" },
  LEE: { body: "#FFFFFF", trim: "#1D428A", pattern: "solid" },
  LEI: { body: "#003090", trim: "#FDBE11", pattern: "solid" },
  LIV: { body: "#C8102E", trim: "#F6EB61", pattern: "solid" },
  LUT: { body: "#F78F1E", trim: "#002D62", pattern: "solid" },
  MCI: { body: "#6CABDD", trim: "#FFFFFF", pattern: "solid" },
  MUN: { body: "#DA291C", trim: "#111111", pattern: "solid" },
  NEW: { body: "#241F20", trim: "#FFFFFF", pattern: "stripes" },
  NFO: { body: "#DD0000", trim: "#FFFFFF", pattern: "solid" },
  SHU: { body: "#EE2737", trim: "#FFFFFF", pattern: "stripes" },
  SOU: { body: "#D71920", trim: "#FFFFFF", pattern: "stripes" },
  SUN: { body: "#EB172B", trim: "#FFFFFF", pattern: "stripes" },
  TOT: { body: "#FFFFFF", trim: "#132257", pattern: "solid" },
  WHU: { body: "#7A263A", trim: "#1BB1E7", pattern: "sleeves" },
  WOL: { body: "#FDB913", trim: "#231F20", pattern: "solid" },
  WAT: { body: "#FBEE23", trim: "#ED2127", pattern: "solid" },
  NOR: { body: "#FFF200", trim: "#00A650", pattern: "solid" },
  MID: { body: "#E21A23", trim: "#FFFFFF", pattern: "solid" },
  WBA: { body: "#122F67", trim: "#FFFFFF", pattern: "stripes" },
  STK: { body: "#E03A3E", trim: "#FFFFFF", pattern: "stripes" },
  COV: { body: "#59CBE8", trim: "#FFFFFF", pattern: "solid" },
  HUL: { body: "#F5A12D", trim: "#111111", pattern: "stripes" },
};

const NEUTRAL: Kit = { body: "#71717A", trim: "#E4E4E7", pattern: "solid" };

export function kitFor(club: string): Kit {
  return KITS[club.toUpperCase()] ?? NEUTRAL;
}

/** Goalkeepers wear a dark shirt with their club's colour on the sleeves. */
export function goalkeeperKit(club: string): Kit {
  const kit = kitFor(club);
  const trim = kit.body.toUpperCase() === "#FFFFFF" ? kit.trim : kit.body;
  return { body: "#27272A", trim, pattern: "sleeves" };
}

/** Whether dark or light text reads better on a colour (for the number on the shirt). */
export function isLight(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
