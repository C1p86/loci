import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { ApiError, apiGet, apiPost } from '../../lib/api.js';
import type { AuthMe } from '../../lib/types.js';
import { useAuthStore } from '../../stores/authStore.js';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginData = z.infer<typeof loginSchema>;

export function Login() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const setFromMe = useAuthStore((s) => s.setFromMe);

  const form = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(data: LoginData) {
    try {
      await apiPost('/api/auth/login', data);
      // Fetch updated me to hydrate auth store
      const me = await apiGet<AuthMe>('/api/auth/me');
      setFromMe(me);
      const redirect = params.get('redirect') ?? '/agents';
      nav(redirect, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        form.setError('root', { message: 'Invalid credentials' });
      } else {
        form.setError('root', { message: 'Something went wrong. Please try again.' });
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <div className="w-full max-w-sm space-y-6 p-8 bg-background rounded-lg border shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Sign in to xci</h1>
          <p className="text-sm text-muted-foreground">Enter your credentials to continue</p>
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
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <p className="text-sm font-medium text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Form>
        <div className="text-center text-sm space-y-1">
          <a href="/forgot-password" className="text-muted-foreground hover:underline block">
            Forgot password?
          </a>
          <a href="/signup" className="text-muted-foreground hover:underline block">
            Don&apos;t have an account? Sign up
          </a>
        </div>
      </div>
    </div>
  );
}
