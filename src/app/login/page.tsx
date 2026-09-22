"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  async function submit(value: string) {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: value }),
    });
    if (res.ok) {
      router.push(params.get("next") || "/");
      router.refresh();
    } else {
      setError("Wrong code");
      setPin("");
    }
  }

  return (
    <div className="border border-border bg-panel rounded-xl p-6 w-full max-w-xs text-center">
      <div className="text-cyan text-[13px] font-semibold mb-4">◆ God&apos;s Eye</div>
      <input
        type="password"
        inputMode="numeric"
        maxLength={4}
        autoFocus
        value={pin}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 4);
          setPin(v);
          setError("");
          if (v.length === 4) submit(v);
        }}
        className="w-full text-center text-[24px] tracking-[12px] bg-bg border border-border rounded-lg py-2 text-text focus:outline-none focus:border-cyan"
        placeholder="····"
      />
      {error && <div className="text-red text-[12px] mt-2">{error}</div>}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
