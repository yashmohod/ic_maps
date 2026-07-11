"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type ComboboxItem<T extends string | number> = {
  value: T;
  label: string;
};

type Props<T extends string | number> = {
  label?: string;
  placeholder: string;
  value: T | null;
  items: ComboboxItem<T>[];
  onChange: (value: T) => void;
  widthClassName?: string;
  disabled?: boolean;
  searchPlaceholder?: string;
};

export default function ComboboxSelect<T extends string | number>({
  label,
  placeholder,
  value,
  items,
  onChange,
  widthClassName,
  disabled,
  searchPlaceholder,
}: Props<T>) {
  const [open, setOpen] = React.useState(false);

  const selectedLabel =
    value == null
      ? ""
      : (items.find((i) => String(i.value) === String(value))?.label ??
        String(value));

  return (
    <div className={cn("flex items-center gap-3", disabled && "opacity-70")}>
      {label ? <span className="text-sm font-medium">{label}</span> : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn("justify-between", widthClassName ?? "w-[260px]")}
          >
            {selectedLabel ? selectedLabel : placeholder}
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className={cn("p-0", widthClassName ?? "w-[260px]")}>
          <Command>
            <CommandInput
              placeholder={searchPlaceholder ?? "Search..."}
              className="h-9"
            />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {items.map((item) => {
                  const isSelected =
                    value != null && String(item.value) === String(value);

                  return (
                    <CommandItem
                      key={String(item.value)}
                      value={item.label}
                      onSelect={() => {
                        onChange(item.value);
                        setOpen(false);
                      }}
                    >
                      {item.label}
                      <Check
                        className={cn(
                          "ml-auto",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
