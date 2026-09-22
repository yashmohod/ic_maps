"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { TriCheckbox } from "@/components/TriCheckbox";
import { Button } from "@/components/ui/button";
import {
  colorSwatchLabel,
  MYMAPS_COLOR_PALETTE,
  MYMAPS_DEFAULT_COLOR,
  normalizeHexColor,
} from "@/lib/mymaps-color";
import {
  groupCheckState,
  standaloneNodesForTree,
  toggleGroupHidden,
  toggleItemHidden,
  type CheckState,
  type ElementKind,
  type HiddenByKind,
} from "@/lib/element-visibility";
import {
  borderMutedClass,
  safeAreaTopClass,
  surfacePanelClass,
} from "@/lib/panel-classes";

type NodeItem = {
  id: number;
  name: string;
  color: string;
};
type EdgeItem = {
  id: number;
  from: number;
  to: number;
  color?: string;
};
type PolyItem = { id: number; name: string; color: string };
type LineItem = { id: number; name: string };
type PointItem = { id: number; name: string };
type TextItem = { id: number; text: string };
type ArrowItem = { id: number; color: string };

type ColorGroup = { color: string; label: string; ids: number[] };

const KIND_META: {
  key: ElementKind;
  label: string;
  colored: boolean;
}[] = [
  { key: "nodes", label: "Nodes", colored: true },
  { key: "edges", label: "Paths", colored: true },
  { key: "polygons", label: "Areas", colored: true },
  { key: "lines", label: "Lines", colored: false },
  { key: "points", label: "Points", colored: false },
  { key: "texts", label: "Text", colored: false },
  { key: "arrows", label: "Arrows", colored: true },
];

const PALETTE_ORDER = MYMAPS_COLOR_PALETTE.map((c) => c.toUpperCase());

function sortColors(colors: string[]): string[] {
  return [...colors].sort((a, b) => {
    const ia = PALETTE_ORDER.indexOf(a.toUpperCase());
    const ib = PALETTE_ORDER.indexOf(b.toUpperCase());
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function groupByColor(
  items: Array<{ id: number; color?: string }>,
): ColorGroup[] {
  const buckets = new Map<string, number[]>();
  for (const item of items) {
    const color = normalizeHexColor(item.color ?? MYMAPS_DEFAULT_COLOR);
    const list = buckets.get(color) ?? [];
    list.push(item.id);
    buckets.set(color, list);
  }
  return sortColors([...buckets.keys()]).map((color) => ({
    color,
    label: colorSwatchLabel(color),
    ids: buckets.get(color) ?? [],
  }));
}

type Props = {
  nodes: NodeItem[];
  edges: EdgeItem[];
  polygons: PolyItem[];
  lines: LineItem[];
  points: PointItem[];
  texts: TextItem[];
  arrows: ArrowItem[];
  hidden: HiddenByKind;
  onHiddenChange: (next: HiddenByKind) => void;
  selected: { kind: ElementKind; id: number } | null;
  onSelect: (kind: ElementKind, id: number) => void;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function FolderRow({
  depth,
  expanded,
  onToggleExpand,
  state,
  onToggleCheck,
  label,
  count,
  swatch,
  checkLabel,
}: {
  depth: number;
  expanded: boolean;
  onToggleExpand: () => void;
  state: CheckState;
  onToggleCheck: () => void;
  label: string;
  count: number;
  swatch?: string;
  checkLabel: string;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      className={[
        "flex min-h-8 w-full items-center gap-1 rounded-md pr-1 text-left text-[12px] hover:bg-panel-muted/70",
        state === "unchecked" ? "text-panel-muted-foreground" : "",
      ].join(" ")}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <button
        type="button"
        className="grid size-5 shrink-0 place-items-center rounded text-panel-muted-foreground hover:text-panel-foreground"
        aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        onClick={onToggleExpand}
      >
        <Chevron size={14} />
      </button>
      <TriCheckbox
        state={state}
        onToggle={onToggleCheck}
        aria-label={checkLabel}
      />
      {swatch ? (
        <span
          className="size-2.5 shrink-0 rounded-full border border-white/80 shadow-sm"
          style={{ backgroundColor: swatch }}
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left font-medium"
        onClick={onToggleExpand}
      >
        {label}
      </button>
      <span className="shrink-0 tabular-nums text-[10px] text-panel-muted-foreground">
        {count}
      </span>
    </div>
  );
}

function ItemRow({
  depth,
  checked,
  onToggle,
  label,
  swatch,
  selected,
  onSelect,
  checkLabel,
}: {
  depth: number;
  checked: boolean;
  onToggle: () => void;
  label: string;
  swatch?: string;
  selected: boolean;
  onSelect: () => void;
  checkLabel: string;
}) {
  return (
    <div
      className={[
        "flex min-h-8 w-full items-center gap-1 rounded-md pr-1 text-[12px]",
        selected ? "bg-brand-cta/15" : "hover:bg-panel-muted/70",
        checked ? "" : "text-panel-muted-foreground",
      ].join(" ")}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="size-5 shrink-0" aria-hidden />
      <TriCheckbox
        state={checked ? "checked" : "unchecked"}
        onToggle={onToggle}
        aria-label={checkLabel}
      />
      {swatch ? (
        <span
          className="size-2.5 shrink-0 rounded-full border border-white/80 shadow-sm"
          style={{ backgroundColor: swatch }}
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        onClick={onSelect}
        title={label}
      >
        {label}
      </button>
    </div>
  );
}

export function ElementTreePanel({
  nodes,
  edges,
  polygons,
  lines,
  points,
  texts,
  arrows,
  hidden,
  onHiddenChange,
  selected,
  onSelect,
  disabled = false,
  open = true,
  onOpenChange,
}: Props) {
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  const isOpen = (key: string, fallback = true) => openFolders[key] ?? fallback;
  const toggleOpen = (key: string, fallback = true) =>
    setOpenFolders((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? fallback),
    }));

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const itemsByKind = useMemo(() => {
    return {
      nodes: standaloneNodesForTree(nodes, edges).map((n) => ({
        id: n.id,
        label: n.name.trim() || `Node ${n.id}`,
        color: normalizeHexColor(n.color),
      })),
      edges: edges.map((e) => {
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        const aName = a?.name.trim() || `Node ${e.from}`;
        const bName = b?.name.trim() || `Node ${e.to}`;
        return {
          id: e.id,
          label: `${aName} → ${bName}`,
          color: normalizeHexColor(e.color ?? MYMAPS_DEFAULT_COLOR),
        };
      }),
      polygons: polygons.map((p) => ({
        id: p.id,
        label: p.name.trim() || `Area ${p.id}`,
        color: normalizeHexColor(p.color),
      })),
      lines: lines.map((l) => ({
        id: l.id,
        label: l.name.trim() || `Line ${l.id}`,
      })),
      points: points.map((p) => ({
        id: p.id,
        label: p.name.trim() || `Point ${p.id}`,
      })),
      texts: texts.map((t) => ({
        id: t.id,
        label: t.text.trim() || `Text ${t.id}`,
      })),
      arrows: arrows.map((a) => ({
        id: a.id,
        label: `Arrow ${a.id}`,
        color: normalizeHexColor(a.color),
      })),
    };
  }, [nodes, edges, polygons, lines, points, texts, arrows, nodeById]);

  const anyHidden = KIND_META.some(({ key }) => hidden[key].size > 0);

  function setKindHidden(kind: ElementKind, next: Set<number>) {
    onHiddenChange({ ...hidden, [kind]: next });
  }

  function showAll() {
    onHiddenChange({
      nodes: new Set(),
      edges: new Set(),
      polygons: new Set(),
      lines: new Set(),
      points: new Set(),
      texts: new Set(),
      arrows: new Set(),
    });
  }

  return (
    <aside
      className={[
        "flex shrink-0 flex-col overflow-hidden border-t transition-[width,max-height,opacity] duration-200 ease-out md:h-full md:border-t-0 md:border-l",
        borderMutedClass,
        surfacePanelClass,
        open
          ? "max-h-[32vh] w-full opacity-100 md:max-h-none md:w-72 md:max-w-72"
          : "pointer-events-none max-h-0 w-full opacity-0 md:max-h-none md:w-0 md:max-w-0 md:border-l-0",
      ].join(" ")}
      aria-hidden={!open}
    >
      <div
        className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${safeAreaTopClass} ${borderMutedClass}`}
      >
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Elements</h2>
          <p className="text-[11px] text-panel-muted-foreground">
            Show or hide on the map
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {anyHidden ? (
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-brand hover:bg-panel-muted"
              onClick={showAll}
            >
              Show all
            </button>
          ) : null}
          {onOpenChange ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="Collapse elements panel"
              onClick={() => onOpenChange(false)}
            >
              <ChevronRight size={16} className="hidden md:block" />
              <ChevronLeft size={16} className="-rotate-90 md:hidden" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {disabled ? (
          <p className="px-2 py-6 text-center text-[12px] text-panel-muted-foreground">
            Select a map to inspect its elements.
          </p>
        ) : (
          <div className="flex flex-col">
            {KIND_META.map(({ key, label, colored }) => {
              const rows = itemsByKind[key];
              const ids = rows.map((r) => r.id);
              const kindKey = `kind:${key}`;
              const expanded = isOpen(kindKey, true);
              const state = groupCheckState(ids, hidden[key]);
              const groups = colored
                ? groupByColor(rows as Array<{ id: number; color?: string }>)
                : null;

              return (
                <div key={key}>
                  <FolderRow
                    depth={0}
                    expanded={expanded}
                    onToggleExpand={() => toggleOpen(kindKey)}
                    state={state}
                    onToggleCheck={() =>
                      setKindHidden(key, toggleGroupHidden(ids, hidden[key]))
                    }
                    label={label}
                    count={ids.length}
                    checkLabel={`${state === "checked" ? "Hide" : "Show"} all ${label.toLowerCase()}`}
                  />
                  {expanded ? (
                    ids.length === 0 ? (
                      <p
                        className="py-1 text-[11px] text-panel-muted-foreground"
                        style={{ paddingLeft: 42 }}
                      >
                        None yet
                      </p>
                    ) : groups ? (
                      groups.map((group) => {
                        const colorKey = `color:${key}:${group.color}`;
                        const colorOpen = isOpen(colorKey, true);
                        const colorState = groupCheckState(
                          group.ids,
                          hidden[key],
                        );
                        return (
                          <div key={colorKey}>
                            <FolderRow
                              depth={1}
                              expanded={colorOpen}
                              onToggleExpand={() => toggleOpen(colorKey)}
                              state={colorState}
                              onToggleCheck={() =>
                                setKindHidden(
                                  key,
                                  toggleGroupHidden(group.ids, hidden[key]),
                                )
                              }
                              label={group.label}
                              count={group.ids.length}
                              swatch={group.color}
                              checkLabel={`${colorState === "checked" ? "Hide" : "Show"} ${group.label} ${label.toLowerCase()}`}
                            />
                            {colorOpen
                              ? group.ids.map((id) => {
                                  const row = rows.find((r) => r.id === id);
                                  if (!row) return null;
                                  return (
                                    <ItemRow
                                      key={`${key}-${id}`}
                                      depth={2}
                                      checked={!hidden[key].has(id)}
                                      onToggle={() =>
                                        setKindHidden(
                                          key,
                                          toggleItemHidden(id, hidden[key]),
                                        )
                                      }
                                      label={row.label}
                                      swatch={group.color}
                                      selected={
                                        selected?.kind === key &&
                                        selected.id === id
                                      }
                                      onSelect={() => onSelect(key, id)}
                                      checkLabel={`${hidden[key].has(id) ? "Show" : "Hide"} ${row.label}`}
                                    />
                                  );
                                })
                              : null}
                          </div>
                        );
                      })
                    ) : (
                      rows.map((row) => (
                        <ItemRow
                          key={`${key}-${row.id}`}
                          depth={1}
                          checked={!hidden[key].has(row.id)}
                          onToggle={() =>
                            setKindHidden(
                              key,
                              toggleItemHidden(row.id, hidden[key]),
                            )
                          }
                          label={row.label}
                          selected={
                            selected?.kind === key && selected.id === row.id
                          }
                          onSelect={() => onSelect(key, row.id)}
                          checkLabel={`${hidden[key].has(row.id) ? "Show" : "Hide"} ${row.label}`}
                        />
                      ))
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
