import { useId } from "react";
import { goalkeeperKit, isLight, kitFor } from "@/lib/kits";

// A plain shirt in a club's colours. `number` is printed where a shirt number
// would go (the pitch uses it for expected points).
const BODY =
  "M22 3 L11 7 L1 17 L8.5 28 L15 24 L15 57 Q15 59 17 59 L47 59 Q49 59 49 57 L49 24 L55.5 28 L63 17 L53 7 L42 3 Q39 9.5 32 9.5 Q25 9.5 22 3 Z";
const LEFT_SLEEVE = "M11 7 L1 17 L8.5 28 L15 24 L15 12 Z";
const RIGHT_SLEEVE = "M53 7 L63 17 L55.5 28 L49 24 L49 12 Z";

export default function Shirt({
  club,
  goalkeeper = false,
  number,
  className = "h-11 w-12",
}: {
  club: string;
  goalkeeper?: boolean;
  number?: string | null;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const kit = goalkeeper ? goalkeeperKit(club) : kitFor(club);
  const ink = isLight(kit.body) ? "#18181B" : "#FFFFFF";
  return (
    <svg viewBox="0 0 64 60" className={className} aria-hidden>
      <defs>
        <clipPath id={`shirt-${id}`}>
          <path d={BODY} />
        </clipPath>
      </defs>
      <path d={BODY} fill={kit.body} />
      <g clipPath={`url(#shirt-${id})`}>
        {kit.pattern === "stripes" &&
          [17, 29, 41].map((x) => <rect key={x} x={x} y={0} width={6} height={60} fill={kit.trim} />)}
        {kit.pattern === "halves" && <rect x={32} y={0} width={32} height={60} fill={kit.trim} />}
        {kit.pattern === "sleeves" && (
          <>
            <path d={LEFT_SLEEVE} fill={kit.trim} />
            <path d={RIGHT_SLEEVE} fill={kit.trim} />
          </>
        )}
      </g>
      <path d="M22 3 Q25 9.5 32 9.5 Q39 9.5 42 3" fill="none" stroke={kit.trim} strokeWidth={2.2} />
      <path d={BODY} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
      {number && (
        <text
          x={32}
          y={41}
          textAnchor="middle"
          fontSize={15}
          fontWeight={700}
          fill={kit.pattern === "stripes" || kit.pattern === "halves" ? "#FFFFFF" : ink}
          stroke={kit.pattern === "stripes" || kit.pattern === "halves" ? "rgba(0,0,0,0.55)" : "none"}
          strokeWidth={kit.pattern === "stripes" || kit.pattern === "halves" ? 3 : 0}
          paintOrder="stroke"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {number}
        </text>
      )}
    </svg>
  );
}
