import DOMPurify from 'dompurify';
export const sanitize = (dirty) => DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [] });
export const sanitizeHTML = (dirty) => DOMPurify.sanitize(dirty);
