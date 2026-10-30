'use client';

import Image from 'next/image';
import {
  ArrowRight,
  BarChart3,
  LockKeyhole,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Brand } from '@/components/brand';
import { clearCsrfToken, dashboardForRole, mutate } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setError('');
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      // Login uses a token issued for the current anonymous browser session.
      clearCsrfToken();

      const result = await mutate<{ user: { role: string } }>(
        '/auth/login',
        'POST',
        {
          email: String(form.get('email')).trim(),
          password: String(form.get('password')),
        }
      );

      clearCsrfToken();
      router.replace(dashboardForRole(result.user.role));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Sign in failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-layout relative isolate min-h-svh lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(460px,.65fr)]">

      {/* LEFT: CINEMATIC BRAND SECTION */}
      <section className="login-art relative hidden min-h-svh flex-col justify-between overflow-hidden text-white lg:flex">

        <Image
          src="/login-hero.png"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="(min-width: 1024px) 68vw, 0px"
          className="login-hero-image object-cover"
        />

        <div className="login-hero-overlay absolute inset-0 z-[1]" />

        {/* Top brand */}
        <div className="login-brand relative z-10">
          <Brand dark />
        </div>

        {/* Main message and features */}
        <div className="login-orbit relative z-10 fade-in">
          <p className="login-eyebrow">
            A connected business workspace
          </p>

          <h1 className="login-main-heading">
            Everything
            <br />
            connected.
            <br />
            <span className="login-headline-accent">
              Business in motion.
            </span>
          </h1>

          <p className="login-description">
            Bring your people, customer relationships, and next steps
            into focus with Orbit.
          </p>

          <div className="login-features">
            <div className="login-feature">
              <span className="login-feature-icon">
                <Users size={21} />
              </span>
              <span>
                <strong>Work together</strong>
                <small>Manage your team and customers</small>
              </span>
            </div>

            <div className="login-feature">
              <span className="login-feature-icon">
                <BarChart3 size={21} />
              </span>
              <span>
                <strong>Stay organized</strong>
                <small>Track leads, follow-ups and growth</small>
              </span>
            </div>

            <div className="login-feature">
              <span className="login-feature-icon">
                <ShieldCheck size={21} />
              </span>
              <span>
                <strong>Secure access</strong>
                <small>Tailored to your role</small>
              </span>
            </div>
          </div>
        </div>

        {/* Bottom brand */}
        <div className="login-bottom-brand relative z-10">
          <div className="login-bottom-brand-identity">
            <Image
              src="/nirvaan-logo.png"
              alt="Nirvaan Tech logo"
              width={44}
              height={44}
              className="login-bottom-logo"
            />
            <div>
              <strong>NIRVAAN TECH</strong>
              <small>Ideas into Impact</small>
            </div>
          </div>

          <a
            href="https://nirvaantech.in"
            target="_blank"
            rel="noreferrer"
          >
            nirvaantech.in ↗
          </a>
        </div>
      </section>

      {/* RIGHT: LOGIN CARD */}
      <section className="login-form-side relative z-10 flex min-h-svh items-center justify-center">

        <div className="w-full max-w-[500px]">

          {/* Mobile-only brand */}
          <div className="mb-6 lg:hidden">
            <Brand dark />
          </div>

          <div className="panel login-panel">

            <div className="mb-7">
              <div className="login-lock-icon mb-4 inline-flex rounded-xl p-3">
                <LockKeyhole size={23} />
              </div>

              <h2 className="text-3xl font-bold tracking-tight">
                Welcome back
              </h2>

              <p className="mt-2 text-base leading-6">
                Sign in to your Orbit workspace.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-5">

              <div>
                <label className="label" htmlFor="email">
                  Work email
                </label>

                <input
                  className="field login-input"
                  id="email"
                  name="email"
                  autoComplete="username"
                  type="email"
                  placeholder="you@company.com"
                  required
                  maxLength={254}
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="label mb-0" htmlFor="password">
                    Password
                  </label>

                  <span className="text-xs text-[#9ca3af]">
                    Contact your admin if you need help
                  </span>
                </div>

                <input
                  className="field login-input"
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  type="password"
                  placeholder="Enter your password"
                  required
                  maxLength={256}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="primary login-submit flex w-full items-center justify-center gap-3 disabled:opacity-60"
              >
                {loading ? 'Signing in…' : 'Sign in securely'}
                {!loading && <ArrowRight size={20} />}
              </button>
            </form>

            <div className="login-card-footer mt-7 border-t pt-6 text-center">
              <p className="text-sm leading-6">
                Authorized access only. Your workspace administrator
                manages accounts.
              </p>
            </div>
          </div>

          <p className="login-tagline mt-6 text-center">
            Orbit <span className="px-1">·</span>
            Everything connected. Business in motion.
          </p>
        </div>
      </section>
    </main>
  );
}
