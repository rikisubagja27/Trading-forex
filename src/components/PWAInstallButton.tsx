import { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/50 text-emerald-300 text-xs font-medium transition-colors whitespace-nowrap ${
          compact ? 'px-3 py-1.5' : 'px-3.5 py-2'
        }`}
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Install NEXORA App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`w-full flex items-center justify-center gap-2 rounded-lg bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] text-slate-200 text-xs font-medium transition-colors whitespace-nowrap ${
            compact ? 'px-3 py-1.5' : 'px-3.5 py-2'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          <span>Install di iPhone / iPad</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-xl bg-[#0D1116] border border-[#1F2731] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-display font-semibold text-white">
                  Pasang NEXORA AI di iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
                <li>
                  Ketuk tombol <strong>Share</strong> (ikon kotak dengan panah ke atas) pada toolbar Safari.
                </li>
                <li>
                  Gulir ke bawah lalu pilih <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Ketuk <strong>Add</strong> di pojok kanan atas untuk menjalankan NEXORA AI dalam mode layar penuh.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-lg bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] py-2 text-xs font-medium text-white"
              >
                Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
