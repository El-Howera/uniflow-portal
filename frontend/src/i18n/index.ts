import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { translate, translateLabel } from './translations';

/**
 * `t('key.path', { x: 5 })` — translate a structured key with optional
 * placeholder substitution. Reads the active locale from AppContext so any
 * component can call `useT()` without props plumbing.
 */
export function useT() {
  const { language } = useAppContext();
  return useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(language, key, params),
    [language]
  );
}

/**
 * `tr('Dashboard')` — translate a literal English string. Used for the
 * sidebar / category labels that are hardcoded and would be expensive to
 * convert to structured keys. Returns the English source unchanged in EN
 * locale or when no mapping exists.
 */
export function useTr() {
  const { language } = useAppContext();
  return useCallback((label: string) => translateLabel(language, label), [language]);
}

export { translate, translateLabel } from './translations';
export type { Locale } from './translations';
