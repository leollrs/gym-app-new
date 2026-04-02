import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Translate text via DeepL edge function with auto-detection.
 *
 * Usage:
 *   const { translate, translating } = useAutoTranslate();
 *   const result = await translate(['Hello', 'Good morning']);
 *   // result = { translations: ['Hola', 'Buenos días'], detected_lang: 'EN', target_lang: 'ES' }
 */
export function useAutoTranslate() {
  const [translating, setTranslating] = useState(false);

  const translate = useCallback(async (texts, targetLang) => {
    if (!texts.length || texts.every(t => !t.trim())) return null;
    setTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke('translate', {
        body: { texts, target_lang: targetLang },
      });
      if (error) {
        console.warn('Translation failed:', error);
        return null;
      }
      return {
        translations: data.translations,
        detected_lang: data.detected_lang,
        target_lang: targetLang,
      };
    } finally {
      setTranslating(false);
    }
  }, []);

  return { translate, translating };
}
