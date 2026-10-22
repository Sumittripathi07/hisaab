"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus } from "lucide-react";
import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { JoinWithLink } from "@/components/join-with-link";
import { CurrencyField, firstError, NameField, NETWORK_ERROR, UpiIdField } from "@/components/profile-fields";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { currencyForLocale, type CurrencyOptions } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { displayNameSchema, timezoneSchema, upiIdSchema } from "@/lib/validation";
import { completeOnboardingAction } from "@/server/actions/profile";

// Steps slide in the direction of travel. MotionConfig below turns the slide into a plain fade for reduced motion.
const slide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -48 }),
};

const primaryButton = "h-12 w-full rounded-xl text-base";
const firstWord = (name: string) => name.trim().split(/\s+/)[0];

type Props = {
  user: { name: string; email: string; image: string | null; timezone: string };
  currencies: CurrencyOptions;
  /** Already checked with safeCallback. */
  callbackURL: string;
  /** Show the "You're all set" step after saving, instead of going straight to callbackURL. */
  showWelcome: boolean;
};

export function OnboardingFlow({ user, currencies, callbackURL, showWelcome }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [moved, setMoved] = useState(false);
  const [name, setName] = useState(user.name);
  const [currency, setCurrency] = useState<string | null>(null); // guessed from the locale when step 2 first opens
  const [upiId, setUpiId] = useState("");
  const [errors, setErrors] = useState<{ name?: string; upiId?: string }>({});
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const upiRef = useRef<HTMLInputElement>(null);
  const total = showWelcome ? 3 : 2;

  function go(to: number) {
    setDirection(to > step ? 1 : -1);
    setMoved(true);
    setStep(to);
  }

  function submitName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const error = firstError(displayNameSchema.safeParse(name));
    setErrors({ name: error });
    if (error) return nameRef.current?.focus();
    setCurrency((c) => c ?? currencyForLocale(Intl.NumberFormat().resolvedOptions().locale));
    go(1);
  }

  async function submitMoney(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const error = firstError(upiIdSchema.safeParse(upiId));
    setErrors({ upiId: error });
    if (error) return upiRef.current?.focus();

    setPending(true);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = await completeOnboardingAction({
      name,
      defaultCurrency: currency ?? "INR",
      upiId,
      // Hidden from the person, so never let an odd browser value block them.
      timezone: timezoneSchema.safeParse(timezone).success ? timezone : user.timezone,
    }).catch(() => ({ ok: false as const, error: NETWORK_ERROR }));

    if (!result.ok) {
      setPending(false);
      toast.error(result.error);
    } else if (showWelcome) {
      setPending(false);
      go(2);
    } else {
      router.replace(callbackURL); // stays "Saving…" until the next page takes over
    }
  }

  return (
    <div className="w-full max-w-md">
      <header className="mb-8 flex h-9 items-center justify-between sm:mb-10">
        {step === 1 ? (
          <Button variant="ghost" className="-ml-2 h-9 px-2 text-muted-foreground" onClick={() => go(0)} disabled={pending}>
            <ArrowLeft aria-hidden />
            Back
          </Button>
        ) : (
          <span className="text-xl font-semibold tracking-tight">
            Hisaab<span className="text-primary">.</span>
          </span>
        )}
        <ProgressDots step={step} total={total} />
      </header>

      <div className="sm:overflow-hidden sm:rounded-3xl sm:border sm:bg-card sm:p-8 sm:shadow-sm">
        <MotionConfig reducedMotion="user">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.section
              key={step}
              custom={direction}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 0 && (
                <form onSubmit={submitName} noValidate className="flex flex-col gap-6">
                  <div className="flex flex-col items-center gap-5 text-center">
                    <UserAvatar name={name} image={user.image} size="lg" className="ring-4 ring-primary/15" />
                    <div className="space-y-2">
                      <StepHeading focus={moved} step={0} total={total}>
                        What should we call you?
                      </StepHeading>
                      <p className="text-balance text-muted-foreground">Friends see this name in groups and on every split.</p>
                    </div>
                  </div>
                  <NameField
                    ref={nameRef}
                    value={name}
                    onChange={(v) => {
                      setName(v);
                      if (errors.name) setErrors({ name: firstError(displayNameSchema.safeParse(v)) });
                    }}
                    error={errors.name}
                    // Only for a blank name on first load: a prefilled one just needs "Continue".
                    autoFocus={!moved && !user.name}
                  />
                  <Button type="submit" className={primaryButton}>
                    Continue
                    <ArrowRight aria-hidden />
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">
                    Signed in as <span className="font-medium break-all text-foreground">{user.email}</span>
                  </p>
                </form>
              )}

              {step === 1 && (
                <form onSubmit={submitMoney} noValidate className="flex flex-col gap-6">
                  <div className="space-y-2 text-center">
                    <StepHeading focus={moved} step={1} total={total}>
                      How do you settle up?
                    </StepHeading>
                    <p className="text-balance text-muted-foreground">Your usual currency, and where friends can pay you back.</p>
                  </div>
                  <CurrencyField value={currency ?? "INR"} onChange={setCurrency} options={currencies} />
                  <UpiIdField
                    ref={upiRef}
                    value={upiId}
                    onChange={(v) => {
                      setUpiId(v);
                      if (errors.upiId) setErrors({ upiId: firstError(upiIdSchema.safeParse(v)) });
                    }}
                    error={errors.upiId}
                  />
                  <Button type="submit" className={primaryButton} disabled={pending}>
                    {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                    {pending ? "Saving…" : "Continue"}
                    {pending ? null : <ArrowRight aria-hidden />}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">You can change these anytime in Account.</p>
                </form>
              )}

              {step === 2 && (
                <Welcome
                  firstName={firstWord(name)}
                  focus={moved}
                  total={total}
                  onCreate={() => router.push("/dashboard?new=1")}
                  onDashboard={() => router.push(callbackURL)}
                />
              )}
            </motion.section>
          </AnimatePresence>
        </MotionConfig>
      </div>
    </div>
  );
}

function Welcome({ firstName, focus, total, onCreate, onDashboard }: {
  firstName: string;
  focus: boolean;
  total: number;
  onCreate: () => void;
  onDashboard: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
        className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"
      >
        <Check className="size-8" strokeWidth={2.5} aria-hidden />
      </motion.div>
      <div className="space-y-2">
        <StepHeading focus={focus} step={2} total={total}>
          You&apos;re all set
        </StepHeading>
        <p className="text-balance text-muted-foreground">
          Welcome aboard, {firstName}. Start a group for your next trip or your flat, or join one a friend shared.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Button className={primaryButton} onClick={onCreate}>
          <Plus aria-hidden />
          Create a group
        </Button>
        <JoinWithLink className={primaryButton} />
        <Button variant="ghost" className={primaryButton} onClick={onDashboard}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}

/** Takes focus when its step slides in (not on first load), so screen readers announce the new step. */
function StepHeading({ focus, step, total, children }: { focus: boolean; step: number; total: number; children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <h1 ref={ref} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-balance outline-none sm:text-3xl">
      <span className="sr-only">
        Step {step + 1} of {total}:{" "}
      </span>
      {children}
    </h1>
  );
}

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all duration-500 motion-reduce:transition-none",
            i === step ? "w-6 bg-primary" : i < step ? "w-1.5 bg-primary" : "w-1.5 bg-muted-foreground/25",
          )}
        />
      ))}
    </div>
  );
}
