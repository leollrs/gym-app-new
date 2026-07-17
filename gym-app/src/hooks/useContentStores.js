// React bindings for the in-memory exercise/meal stores.
//
// The stores seed from the bundled static libraries and swap in the live DB copy
// at boot (see exerciseStore.js / mealStore.js). A component that reads the store
// with a plain getExercises()/getMeals() at render time gets whatever is current,
// but it WON'T re-render when hydration finishes a moment later. These hooks fix
// that: they subscribe via useSyncExternalStore, so counts and lists update the
// instant the DB copy lands — which is what makes "edit the table → the app's
// numbers change" true without shipping a new app bundle.

import { useSyncExternalStore } from 'react';
import { getExercises, subscribeExercises } from '../lib/exerciseStore';
import { getMeals, subscribeMeals } from '../lib/mealStore';

/** Live exercise library — re-renders the caller when the DB copy hydrates. */
export function useExercises() {
  return useSyncExternalStore(subscribeExercises, getExercises, getExercises);
}

/** Live recipe library — re-renders the caller when the DB copy hydrates. */
export function useMeals() {
  return useSyncExternalStore(subscribeMeals, getMeals, getMeals);
}
