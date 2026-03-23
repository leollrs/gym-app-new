/**
 * Fade-in-up animation wrapper for admin components.
 * Uses the `animate-fade-in-up` keyframe defined in index.css.
 */
const FadeIn = ({ delay = 0, children, className = '' }) => (
  <div
    className={`animate-fade-in-up ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
  >
    {children}
  </div>
);

export default FadeIn;
