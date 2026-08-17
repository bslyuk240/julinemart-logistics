import { Bell } from 'lucide-react';

export function NotificationPrompt({ onEnable, onDismiss }: { onEnable: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-6 pb-6 sm:pb-0">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6">
        <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mb-4">
          <Bell className="w-6 h-6 text-primary-600" />
        </div>
        <h3 className="text-base font-bold text-gray-900">Turn on notifications</h3>
        <p className="mt-1 text-sm text-gray-500">
          New delivery offers come in fast — turn on notifications so you don't miss one while your phone's in
          your pocket.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onEnable}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white"
          >
            Turn on
          </button>
        </div>
      </div>
    </div>
  );
}
