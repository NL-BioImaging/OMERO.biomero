import React, { useEffect, useState } from "react";
import { Classes, Colors, PortalProvider } from "@blueprintjs/core";

export const THEME_KEY = "biomero.ui.theme";
export const readTheme = () => {
  try { return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; }
  catch (_) { return "light"; }
};

// All non-Blueprint surfaces use Blueprint's exported palette, not a second theme.
export const themeVariables = (dark) => ({
  "--biomero-canvas": dark ? Colors.DARK_GRAY2 : Colors.LIGHT_GRAY5,
  "--biomero-surface": dark ? Colors.DARK_GRAY3 : Colors.WHITE,
  "--biomero-muted": dark ? Colors.GRAY4 : Colors.GRAY1,
  "--biomero-border": dark ? Colors.DARK_GRAY5 : Colors.LIGHT_GRAY1,
  "--biomero-text": dark ? Colors.LIGHT_GRAY5 : Colors.DARK_GRAY1,
  "--biomero-highlight": dark ? Colors.BLUE1 : Colors.BLUE5,
  colorScheme: dark ? "dark" : "light",
});

export default function BlueprintTheme({ theme, children }) {
  const [portalContainer, setPortalContainer] = useState(null);
  const dark = theme === "dark";
  useEffect(() => {
    try { window.localStorage.setItem(THEME_KEY, theme); } catch (_) { /* Optional persistence. */ }
  }, [theme]);
  return <div className={`biomero-root w-full min-h-screen relative bg-bp-canvas text-bp-text ${dark ? Classes.DARK : ""}`}
    role="region" aria-label="BIOMERO application" data-biomero-theme={theme} style={themeVariables(dark)}>
    <PortalProvider portalContainer={portalContainer || undefined} portalClassName={dark ? `biomero-portal ${Classes.DARK}` : "biomero-portal"}>
      {children}
      <div ref={setPortalContainer} className="biomero-portal-root" />
    </PortalProvider>
  </div>;
}
