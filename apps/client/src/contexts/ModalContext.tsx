import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { Modal } from "../components/Modal";

interface ModalEntry {
  id: string;
  component: () => ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnBackdrop?: boolean;
}

interface ModalManager {
  add: (
    id: string,
    component: () => ReactNode,
    options?: {
      size?: "sm" | "md" | "lg" | "xl" | "full";
      closeOnBackdrop?: boolean;
    }
  ) => void;
  remove: (id: string) => void;
  removeAll: () => void;
  has: (id: string) => boolean;
}

const ModalContext = createContext<ModalManager | undefined>(undefined);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modals, setModals] = useState<ModalEntry[]>([]);
  const router = useRouter();

  const add = useCallback(
    (
      id: string,
      component: () => ReactNode,
      options?: {
        size?: "sm" | "md" | "lg" | "xl" | "full";
        closeOnBackdrop?: boolean;
      }
    ) => {
      setModals((prev) => {
        // Don't add if already exists
        if (prev.some((m) => m.id === id)) {
          return prev;
        }
        return [
          ...prev,
          {
            id,
            component,
            size: options?.size,
            closeOnBackdrop: options?.closeOnBackdrop,
          },
        ];
      });
    },
    []
  );

  const remove = useCallback((id: string) => {
    setModals((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const removeAll = useCallback(() => {
    setModals([]);
  }, []);

  const has = useCallback(
    (id: string) => {
      return modals.some((m) => m.id === id);
    },
    [modals]
  );

  // Close all modals on route change
  useEffect(() => {
    const unsubscribe = router.subscribe("onBeforeLoad", () => {
      removeAll();
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [router, removeAll]);

  // Also close modals when location pathname changes
  useEffect(() => {
    removeAll();
  }, [router.state.location.pathname, removeAll]);

  return (
    <ModalContext.Provider value={{ add, remove, removeAll, has }}>
      {children}
      {modals.map((modal, index) => (
        <Modal
          key={modal.id}
          id={modal.id}
          size={modal.size}
          closeOnBackdrop={modal.closeOnBackdrop}
          zIndex={index}
          isTopmost={index === modals.length - 1}
          onClose={() => remove(modal.id)}
        >
          {modal.component()}
        </Modal>
      ))}
    </ModalContext.Provider>
  );
}

export function useModalManager(): ModalManager {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error("useModalManager must be used within a ModalProvider");
  }
  return context;
}
