import DOMPurify from 'dompurify';
export const sanitize = (dirty) => DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [] });
export const sanitizeHTML = (dirty) => DOMPurify.sanitize(dirty, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br', 'p', 'ul', 'ol', 'li', 'a', 'span'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
});
