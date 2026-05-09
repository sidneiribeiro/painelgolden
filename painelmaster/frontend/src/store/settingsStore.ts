import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  panelName: string;
  logoUrl: string | null;
  setPanelName: (name: string) => void;
  setLogoUrl: (url: string | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      panelName: 'Painel SGPLAY',
      logoUrl: null,
      setPanelName: (name) => set({ panelName: name }),
      setLogoUrl: (url) => set({ logoUrl: url }),
    }),
    {
      name: 'settings-storage',
    }
  )
);

