import { createContext, useCallback, useContext, useRef } from 'react';
import PlanForm from '../components/PlanForm';
import DishForm from '../components/DishForm';
import OccasionForm from '../components/OccasionForm';
import ProfileModal from '../components/ProfileModal';
import FamilyModal from '../components/FamilyModal';
import DeliveryModal from '../components/DeliveryModal';

const ModalContext = createContext(null);

/** Owns the <dialog> refs and mounts PlanForm/DishForm/OccasionForm/
 * ProfileModal/FamilyModal/DeliveryModal once, at the provider level — so
 * they stay mounted (and can be opened) regardless of which route is
 * active, instead of being re-created per-route. Everything else these
 * modals need (session, profile draft, active conversation) they read from
 * Redux themselves; this context only carries open/close. */
export function ModalProvider({ children }) {
  const planFormRef = useRef(null);
  const dishFormRef = useRef(null);
  const occasionFormRef = useRef(null);
  const profileModalRef = useRef(null);
  const familyModalRef = useRef(null);
  const deliveryModalRef = useRef(null);

  const openPlanForm = useCallback(() => planFormRef.current?.showModal(), []);
  const closePlanForm = useCallback(() => planFormRef.current?.close(), []);
  const openDishForm = useCallback(() => dishFormRef.current?.showModal(), []);
  const closeDishForm = useCallback(() => dishFormRef.current?.close(), []);
  const openOccasionForm = useCallback(() => occasionFormRef.current?.showModal(), []);
  const closeOccasionForm = useCallback(() => occasionFormRef.current?.close(), []);
  const openProfileModal = useCallback(() => profileModalRef.current?.showModal(), []);
  const closeProfileModal = useCallback(() => profileModalRef.current?.close(), []);
  const openFamilyModal = useCallback(() => familyModalRef.current?.showModal(), []);
  const closeFamilyModal = useCallback(() => familyModalRef.current?.close(), []);
  const openDeliveryModal = useCallback(() => deliveryModalRef.current?.showModal(), []);
  const closeDeliveryModal = useCallback(() => deliveryModalRef.current?.close(), []);

  return (
    <ModalContext.Provider
      value={{
        openPlanForm,
        closePlanForm,
        openDishForm,
        closeDishForm,
        openOccasionForm,
        closeOccasionForm,
        openProfileModal,
        closeProfileModal,
        openFamilyModal,
        closeFamilyModal,
        openDeliveryModal,
        closeDeliveryModal,
      }}
    >
      {children}
      <PlanForm ref={planFormRef} onClose={closePlanForm} />
      <DishForm ref={dishFormRef} onClose={closeDishForm} />
      <OccasionForm ref={occasionFormRef} onClose={closeOccasionForm} />
      <ProfileModal ref={profileModalRef} onClose={closeProfileModal} />
      <FamilyModal ref={familyModalRef} onClose={closeFamilyModal} />
      <DeliveryModal ref={deliveryModalRef} onClose={closeDeliveryModal} />
    </ModalContext.Provider>
  );
}

export function useModals() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModals must be used within a ModalProvider');
  return ctx;
}
