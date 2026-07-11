import { Suspense } from "react";
import { Spinner } from "@/components/ui/spinner";
import { mapPageClass } from "@/lib/panel-classes";
import MyMapsWorkspacePage from "./workspace";

export default function MyMapsPage() {
  return (
    <Suspense
      fallback={
        <div className={`${mapPageClass} grid place-items-center`}>
          <Spinner className="size-8" />
        </div>
      }
    >
      <MyMapsWorkspacePage />
    </Suspense>
  );
}
