import { create } from "zustand";

export type Store = { id: string; slug: string; nome: string };
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  active: boolean;
};
export type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  stores: Store[];
  activeStoreId: string | null;
  setSession: (payload: {
    accessToken: string;
    user: AuthUser;
    stores: Store[];
  }) => void;
  setActiveStoreId: (storeId: string) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  stores: [],
  activeStoreId: null,
  setSession: (payload) => {
    const current = get();
    const isValidStore = payload.stores.some((s) => s.id === current.activeStoreId);
    set({
      accessToken: payload.accessToken,
      user: payload.user,
      stores: payload.stores,
      activeStoreId: isValidStore ? current.activeStoreId : payload.stores[0]?.id ?? null
    });
  },
  setActiveStoreId: (activeStoreId) => set({ activeStoreId }),
  clear: () =>
    set({ accessToken: null, user: null, stores: [], activeStoreId: null })
}));

export function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
