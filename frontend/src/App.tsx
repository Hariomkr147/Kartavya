import { ComponentPlayground } from "@/pages/_playground/ComponentPlayground";

// Temporary: replaced by real routing (RequireAuth/RequireRole, landing page,
// role dashboards) in Stage 5. This playground proves out every Stage 4
// bespoke UI primitive visually and gets removed once real screens exist.
function App() {
  return <ComponentPlayground />;
}

export default App;
