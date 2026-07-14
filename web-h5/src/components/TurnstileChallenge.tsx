import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

const SCRIPT_ID = 'cloudflare-turnstile-script';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function TurnstileChallenge({
  onVerify,
  onError,
  resetSignal = 0,
}: {
  onVerify: (token: string) => void;
  onError?: () => void;
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previousResetSignal = useRef(resetSignal);
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);
  const [scriptReady, setScriptReady] = useState(Boolean(window.turnstile));
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onErrorRef.current = onError;
  }, [onError, onVerify]);

  useEffect(() => {
    if (window.turnstile) {
      setScriptReady(true);
      return;
    }

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const handleLoad = () => setScriptReady(true);
    const handleError = () => onErrorRef.current?.();
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    return () => {
      script?.removeEventListener('load', handleLoad);
      script?.removeEventListener('error', handleError);
    };
  }, []);

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current || !window.turnstile) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token: string) => onVerifyRef.current(token),
      'expired-callback': () => onVerifyRef.current(''),
      'error-callback': () => onErrorRef.current?.(),
      theme: 'auto',
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
  }, [scriptReady, siteKey]);

  useEffect(() => {
    if (previousResetSignal.current === resetSignal) return;
    previousResetSignal.current = resetSignal;
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onVerifyRef.current('');
    }
  }, [resetSignal]);

  if (!siteKey) {
    return (
      <p className="text-sm text-danger-600 bg-danger-50 rounded-lg p-3">
        验证服务暂不可用，请稍后重试。
      </p>
    );
  }

  return <div ref={containerRef} className="min-h-[65px] flex justify-center" />;
}
