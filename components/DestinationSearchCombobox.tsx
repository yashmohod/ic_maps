"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { mapSearchShellClass, touchTargetClass } from "@/lib/panel-classes";
import { cn } from "@/lib/utils";

export type DestinationSearchItem = {
  id: number;
  name: string;
};

type DestinationSearchComboboxProps = {
  destinations: DestinationSearchItem[];
  value: number;
  onChange: (id: number) => void;
  onAddStop: () => void;
  stopCount?: number;
  loading?: boolean;
  disabled?: boolean;
};

export function DestinationSearchCombobox({
  destinations,
  value,
  onChange,
  onAddStop,
  stopCount = 0,
  loading = false,
  disabled = false,
}: DestinationSearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = destinations.find((d) => Number(d.id) === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter((d) => d.name.toLowerCase().includes(q));
  }, [destinations, query]);

  const displayValue = open ? query : (selected?.name ?? "");

  function handleSelect(id: number) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onChange(0);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={cn(mapSearchShellClass, "gap-1 pr-1")}>
      <Popover open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 flex-1 items-center">
          <Search
            className="ml-1.5 shrink-0 text-panel-muted-foreground"
            size={18}
            aria-hidden="true"
          />
          <PopoverAnchor asChild>
            <input
              id="search-dest"
              type="search"
              role="combobox"
              aria-expanded={open}
              aria-controls="destination-search-list"
              aria-autocomplete="list"
              aria-label="Search campus buildings"
              placeholder={
                loading ? "Loading buildings…" : "Search campus buildings…"
              }
              value={displayValue}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm font-medium outline-none placeholder:text-panel-muted-foreground"
              disabled={disabled || loading}
            />
          </PopoverAnchor>
          {value > 0 && !open ? (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear selected building"
              className={`mr-1 shrink-0 rounded-full p-1.5 text-panel-muted-foreground transition hover:bg-panel-muted hover:text-foreground ${touchTargetClass}`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <PopoverContent
          className="w-[var(--radix-popover-anchor-width)] p-0"
          align="start"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList id="destination-search-list">
              <CommandEmpty>No buildings found.</CommandEmpty>
              <CommandGroup>
                {filtered.map((d) => {
                  const id = Number(d.id);
                  const isSelected = value === id;
                  return (
                    <CommandItem
                      key={id}
                      value={d.name}
                      onSelect={() => handleSelect(id)}
                    >
                      <span className="truncate">{d.name}</span>
                      <Check
                        className={cn(
                          "ml-auto shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        onClick={onAddStop}
        aria-label={
          stopCount > 1
            ? `Edit ${stopCount} stops on this trip`
            : "Add stops to this trip"
        }
        title="Add or edit trip stops"
        className={cn(
          "relative grid h-9 w-9 shrink-0 place-items-center rounded-xl",
          "bg-panel-muted text-panel-foreground transition hover:bg-panel",
          touchTargetClass,
        )}
      >
        <Plus size={20} strokeWidth={2.25} aria-hidden="true" />
        {stopCount > 1 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-cta px-1 text-[10px] font-bold text-brand-cta-foreground">
            {stopCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
