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
  onError?: (code?: string) => void;
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previousResetSignal = useRef(resetSignal);
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);
  const [scriptReady, setScriptReady] = useState(Boolean(window.turnstile));
  const [loadFailed, setLoadFailed] = useState(false);
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

    const handleLoad = () => {
      if (window.turnstile) setScriptReady(true);
      else {
        setLoadFailed(true);
        onErrorRef.current?.();
      }
    };
    const handleError = (code = 'script-load-failed') => {
      setLoadFailed(true);
      onErrorRef.current?.(code);
    };
    const handleScriptError = () => handleError('script-load-failed');

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
    }
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleScriptError);
    if (!script.isConnected) document.head.appendChild(script);
    const timeout = window.setTimeout(() => {
      if (!window.turnstile) handleError('script-timeout');
    }, 10_000);

    if (window.turnstile) handleLoad();
    return () => {
      window.clearTimeout(timeout);
      script?.removeEventListener('load', handleLoad);
      script?.removeEventListener('error', handleScriptError);
    };
  }, []);

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current || !window.turnstile) return;
    let active = true;

    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          if (active) onVerifyRef.current(token);
        },
        'expired-callback': () => {
          if (active) onVerifyRef.current('');
        },
        'error-callback': (code: string) => {
          if (active) onErrorRef.current?.(code || 'widget-error');
        },
        'refresh-expired': 'auto',
        retry: 'auto',
        theme: 'auto',
      });
    } catch {
      setLoadFailed(true);
      onErrorRef.current?.('render-failed');
    }

    return () => {
      active = false;
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId !== null && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [scriptReady, siteKey]);

  useEffect(() => {
    if (previousResetSignal.current === resetSignal) return;
    previousResetSignal.current = resetSignal;
    if (widgetIdRef.current !== null && window.turnstile) {
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

  if (loadFailed) {
    return (
      <p className="text-sm text-danger-600 bg-danger-50 rounded-lg p-3">
        验证组件加载失败，请刷新页面后重试。
      </p>
    );
  }

  if (!scriptReady) {
    return <div className="min-h-[65px] flex items-center justify-center text-sm text-gray-500">正在加载安全验证...</div>;
  }

  return <div ref={containerRef} className="min-h-[65px] flex justify-center" />;
}
