import { Toggle } from "@/components/ui/toggle"
import { CheckIcon, XIcon } from "lucide-react"
import { Dispatch, SetStateAction } from "react";

interface ToggleParams {
    state: boolean;
    setState: Dispatch<SetStateAction<boolean>>;
    name: string;
}

export function ToggleButton({ state, setState, name }: ToggleParams) {
    return (
        <Toggle aria-label="Toggle bookmark" size="sm" variant="outline" pressed={state} onPressedChange={setState}>
            {state ? <XIcon className="group-aria-pressed/toggle:fill-foreground" /> : <CheckIcon className="group-aria-pressed/toggle:fill-foreground" />}
            {name}
        </Toggle>
    )
}
