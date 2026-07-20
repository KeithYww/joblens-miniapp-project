import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { QuestionCard } from '@/components';
import { SettingsModal } from './SettingsModal';
import { TurnstileChallenge } from './TurnstileChallenge';

describe('component resource cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('joblens_locale', 'zh-CN');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete window.turnstile;
  });

  it('clears the settings saved timer on unmount', () => {
    const view = render(
      <I18nProvider>
        <SettingsModal isOpen onClose={() => undefined} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the copy feedback timer on unmount', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const view = render(
      <I18nProvider>
        <QuestionCard questions={['是否有固定无责底薪？']} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '复制第 1 个问题' }));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes a Turnstile widget whose id is an empty string', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key');
    const remove = vi.fn();
    window.turnstile = {
      render: vi.fn().mockReturnValue(''),
      remove,
      reset: vi.fn(),
    };

    const view = render(<TurnstileChallenge onVerify={() => undefined} />);
    view.unmount();
    expect(remove).toHaveBeenCalledWith('');
  });
});
