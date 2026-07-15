import { useState, useEffect } from 'react';
import { X, Settings, CheckCircle2 } from 'lucide-react';
import { setApiBaseUrl, getStoredApiBaseUrl } from '@/api';
import { useI18n } from '@/i18n';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t } = useI18n();
  const [apiUrl, setApiUrl] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiUrl(getStoredApiBaseUrl());
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    setApiBaseUrl(apiUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    setApiUrl('');
    setApiBaseUrl('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/45 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">{t('settings') || '设置'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              {t('apiServer') || 'API 服务地址'}
            </label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://your-api.example.com"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2 text-sm"
            />
            <p className="mt-2 text-xs text-gray-500">
              {t('apiUrlHint') || '部署后端后填写你的 API 服务地址，保存后立即生效。'}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 flex items-center justify-center gap-2"
            >
              {saved ? <CheckCircle2 className="w-4 h-4" /> : null}
              {saved ? (t('saved') || '已保存') : (t('save') || '保存')}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              {t('reset') || '重置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
