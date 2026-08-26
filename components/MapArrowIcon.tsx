import {
  arrowPixelSize,
  MYMAPS_ARROW_PATH,
  MYMAPS_ARROW_VIEW_H,
  MYMAPS_ARROW_VIEW_W,
} from "@/lib/mymaps-arrow-shape";

type Props = {
  color: string;
  size: number;
  className?: string;
  selected?: boolean;
  "aria-label"?: string;
};

/** Tip-up full arrow; rotate with MapLibre Marker `rotation={bearing}`. */
export function MapArrowIcon({
  color,
  size,
  className,
  selected,
  "aria-label": ariaLabel,
}: Props) {
  const { width, height } = arrowPixelSize(size);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${MYMAPS_ARROW_VIEW_W} ${MYMAPS_ARROW_VIEW_H}`}
      className={[
        "block shrink-0",
        selected ? "drop-shadow-[0_0_3px_#fff]" : "",
        className ?? "",
      ].join(" ")}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <path
        d={MYMAPS_ARROW_PATH}
        fill={color}
        stroke="#ffffff"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
