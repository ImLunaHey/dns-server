import { useModalManager } from "../contexts/ModalContext";
import { cn } from "../lib/cn";

interface ConfirmModalProps {
  id: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: "red" | "blue" | "green" | "yellow";
  onConfirm: () => void;
  onCancel?: () => void;
  isPending?: boolean;
}

export function ConfirmModal({
  id,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmColor = "red",
  onConfirm,
  onCancel,
  isPending = false,
}: ConfirmModalProps) {
  const modalManager = useModalManager();

  const handleConfirm = () => {
    onConfirm();
    modalManager.remove(id);
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    modalManager.remove(id);
  };

  const colorClasses = {
    red: "bg-red-600 hover:bg-red-700",
    blue: "bg-blue-600 hover:bg-blue-700",
    green: "bg-green-600 hover:bg-green-700",
    yellow: "bg-yellow-600 hover:bg-yellow-700",
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {title}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={handleCancel}
          disabled={isPending}
          className={cn(
            "px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {cancelLabel}
        </button>
        <button
          onClick={handleConfirm}
          disabled={isPending}
          className={cn(
            "px-4 py-2 rounded text-white",
            colorClasses[confirmColor],
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function useConfirmModal() {
  const modalManager = useModalManager();

  return (
    id: string,
    title: string,
    message: string,
    onConfirm: () => void,
    options?: {
      confirmLabel?: string;
      cancelLabel?: string;
      confirmColor?: "red" | "blue" | "green" | "yellow";
      onCancel?: () => void;
    }
  ) => {
    modalManager.add(
      id,
      () => (
        <ConfirmModal
          id={id}
          title={title}
          message={message}
          confirmLabel={options?.confirmLabel}
          cancelLabel={options?.cancelLabel}
          confirmColor={options?.confirmColor}
          onConfirm={onConfirm}
          onCancel={options?.onCancel}
        />
      ),
      { size: "sm" }
    );
  };
}
