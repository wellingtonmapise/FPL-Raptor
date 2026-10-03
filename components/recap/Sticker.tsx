import { useId } from "react";

// Sticker art for each recap award: bold flat shapes with an ink outline and a
// white sticker border.

const INK = "#1B1B1E";
const ink = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Art({ kind }: { kind: string }) {
  switch (kind) {
    case "top": // a crown
      return (
        <g>
          <path d="M18 70 L 14 30 L 34 48 L 50 20 L 66 48 L 86 30 L 82 70 Z" fill="#FFD23F" {...ink} />
          <rect x="18" y="68" width="64" height="12" rx="3" fill="#FFB703" {...ink} />
          <circle cx="50" cy="56" r="5" fill="#E63946" {...ink} strokeWidth={2} />
          <circle cx="32" cy="60" r="3.5" fill="#4CC9F0" {...ink} strokeWidth={2} />
          <circle cx="68" cy="60" r="3.5" fill="#06D6A0" {...ink} strokeWidth={2} />
        </g>
      );
    case "rocket":
      return (
        <g>
          <path d="M42 70 C 38 80 40 90 34 96 C 46 92 54 86 58 76 Z" fill="#FF9F1C" {...ink} />
          <path d="M40 66 C 44 40 60 20 82 14 C 80 36 66 56 44 72 Z" fill="#fff" {...ink} />
          <path d="M40 66 L 26 64 L 36 50 L 50 50 Z M44 72 L 46 86 L 58 74 L 58 62 Z" fill="#E63946" {...ink} />
          <circle cx="64" cy="36" r="7" fill="#4CC9F0" {...ink} />
        </g>
      );
    case "captain_hero":
    case "captain_fail": {
      const fail = kind === "captain_fail";
      return (
        <g>
          <path d={fail ? "M10 40 H 48 L 44 50 L 50 60 H 10 Z" : "M10 38 H 90 V 62 H 10 Z"} fill="#FFD23F" {...ink} />
          {fail && <path d="M56 42 H 90 V 64 H 56 L 50 56 L 56 48 Z" fill="#FFD23F" {...ink} transform="rotate(10 70 52)" />}
          <text x={fail ? 30 : 50} y="58.5" textAnchor="middle" fontSize="22" fontWeight="900" fill={INK} fontFamily="system-ui, sans-serif">
            C
          </text>
          {fail ? (
            <path d="M30 22 c -4 8 -4 12 0 14 c 4 -2 4 -6 0 -14 z" fill="#4CC9F0" {...ink} strokeWidth={2} />
          ) : (
            <path d="M80 16 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z M22 72 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" fill="#fff" {...ink} strokeWidth={2} />
          )}
        </g>
      );
    }
    case "lone": // a lone star
      return (
        <g>
          <path d="M50 10 L 61 37 L 90 39 L 67 57 L 75 86 L 50 70 L 25 86 L 33 57 L 10 39 L 39 37 Z" fill="#FFD23F" {...ink} />
          <text x="50" y="62" textAnchor="middle" fontSize="26" fontWeight="900" fill={INK} fontFamily="system-ui, sans-serif">
            1
          </text>
        </g>
      );
    case "chip": // a poker chip
      return (
        <g>
          <circle cx="50" cy="50" r="36" fill="#7209B7" {...ink} />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <rect key={a} x="45" y="14" width="10" height="12" fill="#fff" stroke={INK} strokeWidth={2} transform={`rotate(${a} 50 50)`} />
          ))}
          <circle cx="50" cy="50" r="22" fill="#fff" {...ink} />
          <circle cx="50" cy="50" r="15" fill="#B388EB" stroke={INK} strokeWidth={2} />
        </g>
      );
    case "bench": // a park bench, asleep
      return (
        <g>
          <rect x="12" y="34" width="76" height="10" rx="3" fill="#C08552" {...ink} />
          <rect x="12" y="48" width="76" height="10" rx="3" fill="#C08552" {...ink} />
          <rect x="8" y="62" width="84" height="10" rx="3" fill="#A0673B" {...ink} />
          <path d="M18 72 V 88 M82 72 V 88 M22 44 V 48 M78 44 V 48" stroke={INK} strokeWidth={5} strokeLinecap="round" />
          <text x="72" y="26" fontSize="16" fontWeight="900" fill={INK} fontFamily="system-ui, sans-serif">
            z
          </text>
          <text x="82" y="16" fontSize="12" fontWeight="900" fill={INK} fontFamily="system-ui, sans-serif">
            z
          </text>
        </g>
      );
    case "hit": // a bomb
      return (
        <g>
          <path d="M62 26 C 66 16 74 12 82 14" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <path d="M84 6 l3 6 l6 -2 l-3 6 l6 3 l-7 1 l1 7 l-5 -5 l-5 4 l1 -7 l-6 -2 l6 -3 z" fill="#FF9F1C" {...ink} strokeWidth={2} />
          <rect x="52" y="22" width="16" height="12" rx="2" fill="#6C757D" {...ink} transform="rotate(25 60 28)" />
          <circle cx="46" cy="58" r="32" fill="#343A40" {...ink} />
          <circle cx="34" cy="46" r="6" fill="#fff" opacity={0.25} />
          <text x="46" y="67" textAnchor="middle" fontSize="24" fontWeight="900" fill="#fff" fontFamily="system-ui, sans-serif">
            −4
          </text>
        </g>
      );
    case "freefall": // a falling anvil
      return (
        <g>
          <path d="M24 10 V 22 M38 6 V 20 M62 6 V 20 M76 10 V 22" stroke="#fff" strokeWidth={4} strokeLinecap="round" />
          <path d="M14 34 H 86 C 86 44 76 48 66 50 L 64 62 H 74 V 76 H 26 V 62 H 36 L 34 50 C 22 48 14 44 14 34 Z" fill="#6C757D" {...ink} />
          <path d="M20 38 H 60" stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.5} />
        </g>
      );
    case "spoon": // a wooden spoon
      return (
        <g transform="rotate(-30 50 50)">
          <ellipse cx="50" cy="28" rx="16" ry="20" fill="#C08552" {...ink} />
          <ellipse cx="50" cy="28" rx="9" ry="12" fill="#A0673B" />
          <path d="M46 46 L 44 92 C 44 96 56 96 56 92 L 54 46 Z" fill="#C08552" {...ink} />
        </g>
      );
    default:
      return <circle cx="50" cy="50" r="30" fill="#fff" {...ink} />;
  }
}

export default function Sticker({ kind, className = "h-24 w-24" }: { kind: string; className?: string }) {
  const id = `sticker-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden style={{ filter: "drop-shadow(3px 4px 0 rgba(27,27,30,0.85))", overflow: "visible" }}>
      <defs>
        {/* A white sticker border: the art's silhouette, grown and filled white, underneath. */}
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="4" result="grown" />
          <feFlood floodColor="#fff" />
          <feComposite in2="grown" operator="in" result="border" />
          <feMerge>
            <feMergeNode in="border" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        <Art kind={kind} />
      </g>
    </svg>
  );
}
