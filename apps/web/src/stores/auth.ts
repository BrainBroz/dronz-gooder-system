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
  permissions: string[];
  activeStoreId: string | null;
  /** "Todos" no topo: telas que aceitam visão de todas as lojas mostram tudo; as demais usam activeStoreId. */
  viewAll: boolean;
  setViewAll: (viewAll: boolean) => void;
  setSession: (payload: {
    accessToken: string;
    user: AuthUser;
    stores: Store[];
    permissions?: string[];
  }) => void;
  setActiveStoreId: (storeId: string) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  stores: [],
  permissions: [],
  activeStoreId: null,
  viewAll: false,
  setViewAll: (viewAll) => set({ viewAll }),
  setSession: (payload) => {
    const current = get();
    const isValidStore = payload.stores.some((s) => s.id === current.activeStoreId);
    set({
      accessToken: payload.accessToken,
      user: payload.user,
      stores: payload.stores,
      permissions: payload.permissions ?? current.permissions,
      activeStoreId: isValidStore ? current.activeStoreId : payload.stores[0]?.id ?? null
    });
  },
  setActiveStoreId: (activeStoreId) => set({ activeStoreId, viewAll: false }),
  clear: () =>
    set({ accessToken: null, user: null, stores: [], permissions: [], activeStoreId: null, viewAll: false })
}));

export function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
