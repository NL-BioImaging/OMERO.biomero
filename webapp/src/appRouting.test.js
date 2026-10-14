import { resolveAppName } from "./appRouting";

test("routes explicitly between Import, Analyze, and Data Analysis", () => {
  const all = {
    importer_enabled: true,
    analyzer_enabled: true,
    data_analysis_enabled: true,
  };
  expect(resolveAppName("data-analysis", all)).toBe("data-analysis");
  expect(resolveAppName("biomero", all)).toBe("biomero");
  expect(resolveAppName("unknown", all)).toBe("import");
});

test("disabled applications cannot be selected by query parameter", () => {
  expect(
    resolveAppName("data-analysis", {
      importer_enabled: false,
      analyzer_enabled: true,
      data_analysis_enabled: false,
    })
  ).toBe("biomero");
});
