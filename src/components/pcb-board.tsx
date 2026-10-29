export function PcbBoard({ routed }: { routed: boolean }) {
  const traces = [
    "M70 120 H190 V90 H300",
    "M70 150 H160 V210 H300",
    "M70 180 H230 V240 H410",
    "M300 105 V180 H470 V120",
    "M410 255 H520 V180",
    "M190 90 H470",
    "M160 225 H250 V300 H470",
    "M520 195 H560 V260",
  ];
  return (
    <svg viewBox="0 0 640 420" className="h-full w-full" role="img" aria-label="Aperçu PCB généré">
      {/* Carte : substrat crème en mode clair, anthracite en mode sombre */}
      <rect x="30" y="30" width="580" height="360" rx="14" className="fill-[#ece1c8] stroke-black/20 dark:fill-[#17181c] dark:stroke-white/15" />
      <rect x="30" y="30" width="580" height="360" rx="14" fill="none" strokeWidth="1" strokeDasharray="3 7" transform="translate(7 7)" className="stroke-black/15 dark:stroke-white/10" />
      {traces.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          strokeWidth={i < 3 ? 5 : 3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={routed || i < 5 ? "stroke-orange-600/90 dark:stroke-amber-500/85" : "stroke-orange-600/30 dark:stroke-amber-500/20"}
          strokeDasharray={routed || i < 5 ? undefined : "5 6"}
        />
      ))}
      {[
        [58, 108], [58, 138], [58, 168], [288, 78], [288, 168], [458, 108], [398, 243], [508, 168], [238, 288],
      ].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r="8" className="fill-[#faf3e3] stroke-orange-700/70 dark:fill-[#26272d] dark:stroke-amber-400/80" />
          <circle cx={cx} cy={cy} r="3" className="fill-orange-600 dark:fill-amber-300" />
        </g>
      ))}
      <g>
        <rect x="250" y="60" width="105" height="70" rx="6" className="fill-[#2a2b31] stroke-black/30 dark:fill-[#222329] dark:stroke-white/25" />
        <text x="302" y="92" textAnchor="middle" className="fill-zinc-100 text-[11px] font-semibold">ESP32-C3</text>
        <text x="302" y="108" textAnchor="middle" className="fill-zinc-400 text-[8px]">U1 · MINI-1</text>
      </g>
      <g>
        <rect x="430" y="205" width="82" height="58" rx="6" className="fill-[#2a2b31] stroke-black/30 dark:fill-[#222329] dark:stroke-white/25" />
        <text x="471" y="231" textAnchor="middle" className="fill-zinc-100 text-[10px] font-semibold">BME280</text>
        <text x="471" y="246" textAnchor="middle" className="fill-zinc-400 text-[8px]">U2 · I2C</text>
      </g>
      <g>
        <rect x="48" y="275" width="92" height="48" rx="8" className="fill-[#faf3e3] stroke-black/25 dark:fill-[#222329] dark:stroke-white/25" />
        <text x="94" y="296" textAnchor="middle" className="fill-zinc-800 text-[10px] font-semibold dark:fill-zinc-200">USB-C</text>
        <text x="94" y="311" textAnchor="middle" className="fill-zinc-500 text-[8px]">J1 · 5 V</text>
      </g>
      <g>
        <rect x="185" y="275" width="80" height="42" rx="5" className="fill-[#faf3e3] stroke-black/25 dark:fill-[#222329] dark:stroke-white/25" />
        <text x="225" y="300" textAnchor="middle" className="fill-zinc-800 text-[9px] dark:fill-zinc-200">LDO 3V3</text>
      </g>
      {[[390, 90], [535, 285], [120, 210], [545, 95]].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="26" height="14" rx="3" className="fill-zinc-500/70 stroke-black/20 dark:fill-zinc-600/80 dark:stroke-white/20" />
          <text x={x + 13} y={y - 5} textAnchor="middle" className="fill-zinc-600 text-[7px] dark:fill-zinc-400">{["R1", "C4", "C1", "D1"][i]}</text>
        </g>
      ))}
      <text x="48" y="368" className="fill-zinc-600 text-[10px] tracking-[0.18em] dark:fill-zinc-400">SENSOR-NODE · REV A</text>
      <text x="592" y="368" textAnchor="end" className="fill-zinc-500 text-[9px] dark:fill-zinc-600">40 × 30 mm · 2L</text>
      <circle cx="48" cy="48" r="4" className="fill-none stroke-zinc-500" />
      <circle cx="592" cy="48" r="4" className="fill-none stroke-zinc-500" />
    </svg>
  );
}

export function SchematicPreview() {
  const boxes = [
    { x: 50, y: 80, w: 130, h: 76, t: "USB-C", s: "J1 · 5 V" },
    { x: 255, y: 80, w: 130, h: 76, t: "LDO 3,3 V", s: "U3 · TLV75901" },
    { x: 255, y: 235, w: 150, h: 90, t: "ESP32-C3", s: "U1 · MINI-1" },
    { x: 480, y: 235, w: 120, h: 90, t: "BME280", s: "U2 · I2C" },
  ];
  return (
    <svg viewBox="0 0 650 420" className="h-full w-full" role="img" aria-label="Aperçu schéma">
      {boxes.map((b) => (
        <g key={b.t}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="8" className="fill-white/80 stroke-black/20 dark:fill-[#1d1e24] dark:stroke-white/20" />
          <text x={b.x + b.w / 2} y={b.y + 34} textAnchor="middle" className="fill-zinc-800 text-[13px] font-semibold dark:fill-zinc-100">{b.t}</text>
          <text x={b.x + b.w / 2} y={b.y + 54} textAnchor="middle" className="fill-zinc-500 text-[9px]">{b.s}</text>
        </g>
      ))}
      <path d="M180 118 H255 M385 118 H455 V235 M330 235 V156 M405 280 H480" fill="none" strokeWidth="2.5" className="stroke-orange-600/85 dark:stroke-amber-500/80" />
      {[[180, 118], [330, 190], [455, 190], [440, 280]].map(([cx, cy]) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="4" className="fill-orange-600 dark:fill-amber-400" />)}
      <text x="205" y="105" className="fill-zinc-500 text-[9px]">VBUS</text>
      <text x="340" y="200" className="fill-zinc-500 text-[9px]">3V3</text>
      <text x="420" y="265" className="fill-zinc-500 text-[9px]">SDA / SCL</text>
    </svg>
  );
}
