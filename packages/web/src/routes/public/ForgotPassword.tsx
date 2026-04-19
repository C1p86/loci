import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button.js';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../components/ui/form.js';
import { Input } from '../../components/ui/input.js';
import { apiPost } from '../../lib/api.js';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
});

type Data = z.infer<typeof schema>;

export function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<Data>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  async function onSubmit(data: Data) {
    try {
      await apiPost('/api/auth/request-reset', { email: data.email });
    } catch {
      // No error enumeration — always show success message
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40">
        <div className="w-full max-w-sm space-y-4 p-8 bg-background rounded-lg border shadow-sm text-center">
          <h1 className="text-xl font-bold">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            If an account exists for that address, you&apos;ll receive a password reset link
            shortly.
          </p>
          <a href="/login" className="text-sm text-muted-foreground hover:underline block">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <div className="w-full max-w-sm space-y-6 p-8 bg-background rounded-lg border shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>
        </Form>
        <div className="text-center text-sm">
          <a href="/login" className="text-muted-foreground hover:underline">
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}
