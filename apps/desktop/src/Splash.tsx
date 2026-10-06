import { useEffect, useState } from "react";
import { BotLogo } from "@botifyr/ui";

/** Branded startup screen shown briefly while the app boots. */
export function Splash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1300);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="splash">
      <div className="splash-inner">
        <BotLogo size={104} className="splash-logo" />
        <div className="splash-name">Botifyr</div>
        <div className="splash-sub">cloud-managed AI agent</div>
      </div>
    </div>
  );
}
