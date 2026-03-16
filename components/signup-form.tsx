"use client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input"
import { z } from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { authClient } from "@/lib/auth-client";


const formSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  name:z.string().min(1),
}).superRefine(({ confirmPassword, password }, ctx) => {
  if (confirmPassword !== password) {
    ctx.addIssue({
      code: "custom",
      message: "The passwords did not match",
      path: ['confirmPassword']
    });
  }
});;




export function SignupForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  // 1. Define your form.
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      confirmPassword: "",
    },
  });


// 2. Define a submit handler.
async function onSubmit(values: z.infer<typeof formSchema>) {
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


  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <h2 className="text-xl leading-none font-semibold">Create your account</h2>
          <CardDescription>
            Enter your email below to create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">           
            <FieldGroup>
              <Field>
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name <span className="text-xs text-muted-foreground">(required)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="Lewis Hamilton" autoComplete="name" aria-required="true" {...field} />
                        </FormControl>
                        <div aria-live="polite"><FormMessage /></div>
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
                <Field className="grid grid-cols-2 gap-4">
                  <Field>
                    <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password <span className="text-xs text-muted-foreground">(required)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="*********" type="password" autoComplete="new-password" aria-required="true" {...field} />
                        </FormControl>
                        <div aria-live="polite"><FormMessage /></div>
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
                        <FormLabel>Confirm Password <span className="text-xs text-muted-foreground">(required)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="*********" type="password" autoComplete="new-password" aria-required="true" {...field} />
                        </FormControl>
                        <div aria-live="polite"><FormMessage /></div>
                      </FormItem>
                    )}
                  />
                  </Field>
                </Field>
                
              </Field>
              <Field>
                  <Button type="submit" className="w-full bg-brand-cta text-brand-cta-foreground uppercase font-semibold tracking-wide hover:bg-brand-cta/90">Create Account</Button>
                <FieldDescription className="text-center">
                  Already have an account? <a href="/account/login">Sign in</a>
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
  )
}
