"use client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldSeparator,
} from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner"
import React, { useState} from "react";
import { authClient } from "@/lib/auth-client";
const formSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {

  const [loading,setLoading]= useState(false);
  const router = useRouter();
  // 1. Define your form.
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // 2. Define a submit handler.
  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);

  const { data, error } = await authClient.signIn.email({
    email: values.email,
    password: values.password,
    // if supported in your setup:
    rememberMe: true,
  });

  if (error) {
    toast.error(error.message);
    setLoading(false);
    return;
  }

  toast.success("Logged in successfully");
  router.replace("/");
  router.refresh(); // optional
  setLoading(false);  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <h2 className="text-xl leading-none font-semibold">Welcome</h2>
          <CardDescription>Login with</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                <FieldGroup>
                <Field>
                  <Button variant="outline" type="button">
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
                  {/* <Button variant="outline" type="button">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path
                      d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                      fill="currentColor"
                    />
                  </svg>
                  Google
                </Button> */}
                </Field>
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  Or continue with
                </FieldSeparator>
                <Field>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email <span className="text-xs text-muted-foreground">(required)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="name@example.com" autoComplete="email" aria-required="true" {...field} />
                        </FormControl>
                        <div aria-live="polite"><FormMessage /></div>
                      </FormItem>
                    )}
                  />
                </Field>
                <Field>
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password <span className="text-xs text-muted-foreground">(required)</span></FormLabel>

                        <FormControl>
                          <Input placeholder="**********" type="password" autoComplete="current-password" aria-required="true" {...field} />
                        </FormControl>
                        <div aria-live="polite"><FormMessage /></div>
                        <a
                          href="/account/forgot-password"
                          className="ml-auto text-sm underline-offset-4 hover:underline"
                        >
                          Forgot your password?
                        </a>
                      </FormItem>
                    )}
                  />
                </Field>
                <Field>
                  <Button type="submit" disabled={loading} aria-busy={loading} className="w-full bg-brand-cta text-brand-cta-foreground uppercase font-semibold tracking-wide hover:bg-brand-cta/90">{loading ? <><Spinner /><span className="sr-only">Loading</span></> : null}Login</Button>
                  <FieldDescription className="text-center">
                    Don&apos;t have an account? <a href="/account/signup">Sign up</a>
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
