"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState, Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    const res = await signIn("credentials", {
      redirect: false,
      email,
      password,
    });

    if (res?.error) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="uk-flex uk-flex-center uk-flex-middle uk-height-viewport uk-background-muted">
      <div className="uk-card uk-card-default uk-card-body uk-width-medium">
        <h3 className="uk-card-title uk-text-center">Ticket System</h3>
        <p className="uk-text-center uk-text-muted uk-text-small">Sign in to your account</p>

        {error && (
          <div className="uk-alert uk-alert-danger uk-margin-small-top" data-uk-alert>
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="uk-form-stacked uk-margin-top">
          <div className="uk-margin">
            <label className="uk-form-label" htmlFor="email">
              Email
            </label>
            <div className="uk-form-controls">
              <input
                className="uk-input"
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          <div className="uk-margin">
            <label className="uk-form-label" htmlFor="password">
              Password
            </label>
            <div className="uk-form-controls">
              <input
                className="uk-input"
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <div className="uk-margin">
            <button
              className="uk-button uk-button-primary uk-width-1-1"
              type="submit"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="uk-flex uk-flex-center uk-flex-middle uk-height-viewport">
          <div data-uk-spinner />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
