// Each manager's cartoon raptor: skin, eyes and headgear are picked from their
// FPL team id, so the same manager always gets the same raptor.

const INK = "#1B1B1E";
const SKINS = [
  { skin: "#5BD17A", belly: "#C8F5D2", spots: "#3FAE5E" },
  { skin: "#4CC9F0", belly: "#D2F3FC", spots: "#2BA6CC" },
  { skin: "#FF8FAB", belly: "#FFE0E8", spots: "#E86A8A" },
  { skin: "#FFB703", belly: "#FFE9B0", spots: "#E09A00" },
  { skin: "#B388EB", belly: "#EADCFB", spots: "#9265D0" },
  { skin: "#FF7A5C", belly: "#FFD9CF", spots: "#E05A3C" },
  { skin: "#2EC4B6", belly: "#C9F3EF", spots: "#1FA196" },
  { skin: "#A3D93F", belly: "#E6F6C7", spots: "#86BC25" },
];
const HAT_COLOURS = ["#E63946", "#1D3557", "#F4A261", "#7209B7", "#06D6A0", "#FFD23F"];
const GEAR = ["none", "cap", "shades", "headband", "beanie", "crown", "cap", "shades"] as const;
export type Gear = (typeof GEAR)[number];

/** A small deterministic hash so the same seed always draws the same raptor. */
export function raptorLook(seed: number) {
  let h = (seed * 2654435761) >>> 0;
  const next = (n: number) => {
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    return h % n;
  };
  return {
    palette: SKINS[next(SKINS.length)],
    gear: GEAR[next(GEAR.length)] as Gear,
    hat: HAT_COLOURS[next(HAT_COLOURS.length)],
    spots: next(2) === 1,
    sleepy: next(4) === 0,
  };
}

export default function Raptor({ seed, className = "h-24 w-24", mood = "smug" }: { seed: number; className?: string; mood?: "smug" | "sad" }) {
  const look = raptorLook(seed);
  const { skin, belly, spots } = look.palette;
  const stroke = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      {/* neck and shoulders */}
      <path d="M26 120 C 28 100 34 86 44 78 L 64 74 C 64 90 66 106 72 120 Z" fill={skin} {...stroke} />
      <path d="M48 86 C 50 98 52 110 56 120 L 68 120 C 64 108 62 96 62 82 Z" fill={belly} />
      {/* back spikes */}
      <path d="M34 54 L 18 50 L 30 42 L 18 32 L 34 32 L 28 20 L 44 26 L 44 14 L 54 24" fill={skin} {...stroke} />
      {/* head */}
      <path
        d="M30 62 C 24 40 38 20 62 20 C 78 20 90 28 100 38 C 110 46 112 56 106 61 C 100 66 88 66 76 66 L 66 70 C 52 78 36 76 30 62 Z"
        fill={skin}
        {...stroke}
      />
      {look.spots && (
        <g fill={spots}>
          <circle cx="44" cy="34" r="3.5" />
          <circle cx="38" cy="46" r="2.5" />
          <circle cx="50" cy="26" r="2" />
        </g>
      )}
      {/* jaw and teeth */}
      <path d="M68 60 C 80 63 94 62 106 58" fill="none" {...stroke} />
      <path d="M78 61.5 l3 5 l3 -4.6 M88 61.6 l3 4.8 l3 -5" fill="#fff" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx="99" cy="44" r="2" fill={INK} />
      <ellipse cx="80" cy="52" rx="5" ry="3" fill="#FF5D8F" opacity={0.45} />
      {/* eye */}
      <ellipse cx="62" cy="40" rx="10" ry="11" fill="#fff" {...stroke} />
      <circle cx={look.palette && mood === "sad" ? 62 : 65} cy={mood === "sad" ? 44 : 41} r="5" fill={INK} />
      <circle cx={mood === "sad" ? 64 : 67} cy={mood === "sad" ? 42 : 39} r="1.6" fill="#fff" />
      {(look.sleepy || mood === "sad") && <path d="M52 37 C 56 33 68 33 72 37 L 72 30 C 66 27 56 27 52 30 Z" fill={skin} {...stroke} />}
      <path d={mood === "sad" ? "M52 28 L 70 25" : "M51 27 L 71 31"} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      {mood === "sad" && <path d="M74 50 c -2 4 -2 7 1 8 c 3 -1 3 -4 -1 -8 z" fill="#4CC9F0" stroke={INK} strokeWidth={1.5} />}

      {look.gear === "cap" && (
        <g>
          <path d="M40 30 C 44 12 76 10 86 26 Z" fill={look.hat} {...stroke} />
          <path d="M80 25 L 108 29 C 111 31 109 34 104 34 L 78 31 Z" fill={look.hat} {...stroke} />
          <circle cx="62" cy="15" r="2.5" fill={INK} />
        </g>
      )}
      {look.gear === "beanie" && (
        <g>
          <path d="M38 32 C 40 12 78 8 86 28 Z" fill={look.hat} {...stroke} />
          <path d="M36 32 C 52 26 72 25 88 29 L 88 35 C 72 31 52 32 37 38 Z" fill="#fff" {...stroke} />
          <circle cx="62" cy="9" r="5" fill="#fff" {...stroke} />
        </g>
      )}
      {look.gear === "headband" && (
        <g>
          <path d="M34 34 C 50 27 76 26 92 32 L 90 39 C 74 33 50 35 36 41 Z" fill={look.hat} {...stroke} />
          <path d="M34 36 L 20 30 M34 38 L 22 42" stroke={look.hat} strokeWidth={4} strokeLinecap="round" />
        </g>
      )}
      {look.gear === "crown" && (
        <g>
          <path d="M42 26 L 44 6 L 54 18 L 62 2 L 70 18 L 80 6 L 80 26 Z" fill="#FFD23F" {...stroke} />
          <circle cx="62" cy="19" r="2.5" fill="#E63946" />
        </g>
      )}
      {look.gear === "shades" && (
        <g>
          <path d="M48 33 H 78 C 80 33 81 34 81 36 V 40 C 81 46 77 50 71 50 H 57 C 51 50 47 46 47 40 V 36 C 47 34 47 33 48 33 Z" fill={INK} />
          <path d="M52 37 L 58 37" stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.7} />
          <path d="M47 36 L 32 32" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}
