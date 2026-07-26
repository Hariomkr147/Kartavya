import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocation, useOutlet } from "react-router-dom";

/**
 * Drop-in replacement for react-router's <Outlet/> that cross-fades + slides
 * between matched routes instead of swapping instantly. `useOutlet()` gives
 * us the resolved child element so it can be keyed by pathname and handed to
 * AnimatePresence — the standard recipe for animating a data-router's routed
 * content.
 */
export function AnimatedOutlet() {
  const location = useLocation();
  const element = useOutlet();
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <div className="flex min-h-0 flex-1 flex-col">{element}</div>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {element}
      </motion.div>
    </AnimatePresence>
  );
}
