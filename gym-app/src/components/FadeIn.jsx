import { motion } from 'framer-motion';

const FadeIn = ({ children, duration = 0.15, className = '' }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration }}
    className={className}
  >
    {children}
  </motion.div>
);

export default FadeIn;
