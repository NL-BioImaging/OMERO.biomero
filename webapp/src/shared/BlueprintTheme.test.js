import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, Classes } from "@blueprintjs/core";
import BlueprintTheme, { readTheme, THEME_KEY } from "./BlueprintTheme";

function Example() {
  const [theme, setTheme] = useState(readTheme);
  return <BlueprintTheme theme={theme}>
    <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Toggle theme</button>
    <Dialog isOpen title="Theme test"><p>Portal content</p></Dialog>
  </BlueprintTheme>;
}

test("Blueprint dark theme covers scoped portals and persists without touching OMERO's body", async () => {
  localStorage.clear();
  document.body.className = "omero-page";
  const view = render(<Example />);
  const region = screen.getByRole("region", { name: "BIOMERO application" });
  fireEvent.click(screen.getByText("Toggle theme"));
  // Portal ancestry is the behavior under test; it cannot be asserted by label alone.
  // eslint-disable-next-line testing-library/no-node-access
  await waitFor(() => expect(screen.getByText("Portal content").closest(".biomero-portal")).toHaveClass(Classes.DARK));
  expect(region).toHaveClass(Classes.DARK);
  expect(document.body).toHaveClass("omero-page");
  expect(document.body).not.toHaveClass(Classes.DARK);
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  expect(region).toContainElement(screen.getByText("Portal content"));
  fireEvent.click(screen.getByText("Toggle theme"));
  expect(region).not.toHaveClass(Classes.DARK);
  // eslint-disable-next-line testing-library/no-node-access -- Verify the portal's theme is removed too.
  expect(screen.getByText("Portal content").closest(".biomero-portal")).not.toHaveClass(Classes.DARK);
  view.unmount();
  expect(document.body.className).toBe("omero-page");
  document.body.className = "";
});
