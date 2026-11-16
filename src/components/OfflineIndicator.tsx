import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-amber-950/95 border border-amber-700/70 px-3.5 py-2 text-xs font-medium text-amber-200">
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>Offline Mode — Menampilkan aset tersimpan; eksekusi broker tertunda hingga koneksi kembali.</span>
    </div>
  );
}
