"use client";

import React, { useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Field, FieldGroup } from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";

const formSchema = z.object({
  text: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(5000, "Description must be at most 5000 characters"),
});

type AccessibilityReportFormProps = {
  className?: string;
  onSuccess: (reportId: number) => void;
};

export function AccessibilityReportForm({
  className,
  onSuccess,
}: AccessibilityReportFormProps) {
  const [loading, setLoading] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { text: "" },
  });

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  }

  function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      toast.error("Unsupported file type. Use png, jpg, webp, or gif.");
      event.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large. Max size is 10MB.");
      event.target.value = "";
      return;
    }

    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("text", values.text);
      if (photoFile) formData.append("photo", photoFile);

      const resp = await fetch("/api/report/accessibility", {
        method: "POST",
        body: formData,
      });

      const data = (await resp.json().catch(() => null)) as {
        error?: string;
        id?: number;
      } | null;

      if (!resp.ok) {
        toast.error(data?.error ?? "Failed to submit accessibility report");
        return;
      }

      if (typeof data?.id !== "number") {
        toast.error("Unexpected response from server");
        return;
      }

      onSuccess(data.id);
    } catch {
      toast.error("Failed to submit accessibility report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <Card>
        <CardHeader className="text-center">
          <h2 className="text-xl leading-none font-semibold">
            Accessibility report
          </h2>
          <CardDescription>
            Tell us about a barrier you encountered using IC Maps — for example
            screen reader issues, contrast, keyboard navigation, or missing
            labels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FieldGroup>
                <Field>
                  <FormField
                    control={form.control}
                    name="text"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Description{" "}
                          <span className="text-xs text-muted-foreground">
                            (required)
                          </span>
                        </FormLabel>
                        <FormControl>
                          <textarea
                            {...field}
                            rows={5}
                            placeholder="Describe the accessibility barrier and where you encountered it..."
                            aria-required="true"
                            className={cn(
                              "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[120px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                            )}
                          />
                        </FormControl>
                        <div aria-live="polite">
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />
                </Field>

                <Field>
                  <FormLabel>
                    Screenshot{" "}
                    <span className="text-xs text-muted-foreground">
                      (optional)
                    </span>
                  </FormLabel>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={onPhotoChange}
                  />
                  {photoPreview ? (
                    <div className="space-y-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoPreview}
                        alt="Accessibility report preview"
                        className="max-h-48 w-full rounded-md border border-border object-contain"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clearPhoto}
                      >
                        <X size={16} aria-hidden="true" />
                        Remove screenshot
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => uploadInputRef.current?.click()}
                    >
                      <ImagePlus size={16} aria-hidden="true" />
                      Add screenshot
                    </Button>
                  )}
                </Field>

                <Field>
                  <Button
                    type="submit"
                    disabled={loading}
                    aria-busy={loading}
                    className="w-full bg-brand-cta text-brand-cta-foreground font-semibold tracking-wide uppercase hover:bg-brand-cta/90"
                  >
                    {loading ? (
                      <>
                        <Spinner />
                        <span className="sr-only">Submitting</span>
                      </>
                    ) : null}
                    Submit report
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
