"use client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { z } from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { authClient } from "@/lib/auth-client";
import { isIthacaEduEmail, IC_SSO_REQUIRED_MESSAGE } from "@/lib/auth-domains";
import { signInWithMicrosoft } from "@/lib/microsoft-sign-in";
import Image from "next/image";
import { Spinner } from "@/components/ui/spinner";
import { useState } from "react";

const formSchema = z
  .object({
    email: z.string().email(),
    password: z.string(),
    confirmPassword: z.string(),
    name: z.string().min(1),
  })
  .superRefine(({ confirmPassword, password, email }, ctx) => {
    if (isIthacaEduEmail(email)) return;
    if (password.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Password must be at least 8 characters",
        path: ["password"],
      });
    }
    if (confirmPassword !== password) {
      ctx.addIssue({
        code: "custom",
        message: "The passwords did not match",
        path: ["confirmPassword"],
      });
    }
  });

export function SignupForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      confirmPassword: "",
    },
  });
  const emailValue = form.watch("email");
  const requiresMicrosoftSso = isIthacaEduEmail(emailValue ?? "");

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (isIthacaEduEmail(values.email)) {
      toast.message(IC_SSO_REQUIRED_MESSAGE);
      setMicrosoftLoading(true);
      await signInWithMicrosoft({
        callbackURL: "/",
        loginHint: values.email.trim(),
      });
      setMicrosoftLoading(false);
      return;
    }

    const { email, password, name } = values;

    const { data, error } = await authClient.signUp.email({
      email,
      password,
      name,
      // optional if your setup supports it:
      // callbackURL: "/",
    });

    if (error) {
      toast.error(error.message ?? "Failed to create account");
      return;
    }

    // If your Better Auth config has autoSignIn on signup (default), you’re now logged in.
    toast.success("Account created!");
    router.replace("/");
    router.refresh(); // ensures server components read the new cookie
  }

  async function handleMicrosoftSignIn() {
    setMicrosoftLoading(true);
    try {
      await signInWithMicrosoft({
        callbackURL: "/",
        loginHint: requiresMicrosoftSso ? emailValue.trim() : undefined,
      });
    } finally {
      setMicrosoftLoading(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <h2 className="text-xl leading-none font-semibold">
            Create your account
          </h2>
          <CardDescription>
            Sign up with IC Net Pass or use email and password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 space-y-2">
            <Button
              variant="outline"
              type="button"
              className="w-full"
              disabled={microsoftLoading}
              aria-busy={microsoftLoading}
              onClick={() => void handleMicrosoftSignIn()}
            >
              {microsoftLoading ? <Spinner /> : null}
              <Image
                src="/assets/ic_logo_up.png"
                alt="Ithaca College logo"
                width={10}
                height={10}
                className="max-h-6 w-auto dark:hidden"
              />
              <Image
                src="/assets/ic_logo_up_dark.png"
                alt="Ithaca College logo"
                width={10}
                height={10}
                className="hidden max-h-6 w-auto dark:block"
              />
              IC Net Pass
            </Button>
            {requiresMicrosoftSso ? (
              <p className="text-center text-xs text-brand-cta">
                {IC_SSO_REQUIRED_MESSAGE}
              </p>
            ) : null}
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FieldGroup>
                <Field>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Name{" "}
                          <span className="text-xs text-muted-foreground">
                            (required)
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Lewis Hamilton"
                            autoComplete="name"
                            aria-required="true"
                            {...field}
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
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Email{" "}
                          <span className="text-xs text-muted-foreground">
                            (required)
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="name@example.com"
                            autoComplete="email"
                            aria-required="true"
                            {...field}
                          />
                        </FormControl>
                        <div aria-live="polite">
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />
                </Field>
                {!requiresMicrosoftSso ? (
                  <>
                    <Field>
                      <Field className="grid grid-cols-2 gap-4">
                        <Field>
                          <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  Password{" "}
                                  <span className="text-xs text-muted-foreground">
                                    (required)
                                  </span>
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="*********"
                                    type="password"
                                    autoComplete="new-password"
                                    aria-required="true"
                                    {...field}
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
                          <FormField
                            control={form.control}
                            name="confirmPassword"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  Confirm Password{" "}
                                  <span className="text-xs text-muted-foreground">
                                    (required)
                                  </span>
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="*********"
                                    type="password"
                                    autoComplete="new-password"
                                    aria-required="true"
                                    {...field}
                                  />
                                </FormControl>
                                <div aria-live="polite">
                                  <FormMessage />
                                </div>
                              </FormItem>
                            )}
                          />
                        </Field>
                      </Field>
                    </Field>
                  </>
                ) : null}
                <Field>
                  <Button
                    type="submit"
                    disabled={microsoftLoading}
                    className="w-full bg-brand-cta text-brand-cta-foreground uppercase font-semibold tracking-wide hover:bg-brand-cta/90"
                  >
                    {requiresMicrosoftSso
                      ? "Continue with Microsoft"
                      : "Create Account"}
                  </Button>
                  <FieldDescription className="text-center">
                    Already have an account?{" "}
                    <a href="/account/login">Sign in</a>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </Form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  );
}
