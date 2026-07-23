import { WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/** Slim connectivity banner — the app otherwise gives no signal when the network drops mid-session. */
export function OfflineBanner() {
  const online = useOnlineStatus();

  return (
    <AnimatePresence initial={false}>
      {!online && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="bg-sla-overdue-subtle text-sla-overdue flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium">
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            You're offline — changes won't save until your connection is back.
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
