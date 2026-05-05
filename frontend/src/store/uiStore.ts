import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  theme: 'dark' | 'light';
  
  // Modal states
  createCustomerModalOpen: boolean;
  createTrialModalOpen: boolean;
  customerDetailsModalOpen: boolean;
  selectedCustomerId: string | null;
  
  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  
  // Modal actions
  openCreateCustomerModal: () => void;
  closeCreateCustomerModal: () => void;
  openCreateTrialModal: () => void;
  closeCreateTrialModal: () => void;
  openCustomerDetailsModal: (customerId: string) => void;
  closeCustomerDetailsModal: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarCollapsed: false,
      theme: 'dark',
      
      createCustomerModalOpen: false,
      createTrialModalOpen: false,
      customerDetailsModalOpen: false,
      selectedCustomerId: null,

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({
        theme: state.theme === 'dark' ? 'light' : 'dark',
      })),
      
      openCreateCustomerModal: () => set({ createCustomerModalOpen: true }),
      closeCreateCustomerModal: () => set({ createCustomerModalOpen: false }),
      
      openCreateTrialModal: () => set({ createTrialModalOpen: true }),
      closeCreateTrialModal: () => set({ createTrialModalOpen: false }),
      
      openCustomerDetailsModal: (customerId) => set({ 
        customerDetailsModalOpen: true, 
        selectedCustomerId: customerId 
      }),
      closeCustomerDetailsModal: () => set({ 
        customerDetailsModalOpen: false, 
        selectedCustomerId: null 
      }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    }
  )
);
