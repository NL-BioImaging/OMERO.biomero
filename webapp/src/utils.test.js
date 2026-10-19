import { codePointNameCompare, transformStructure } from "./utils";

test("top-level OMERO sources use character-aware alphabetical order", () => {
  const tree = transformStructure({
    projects: [
      { id: 1, name: "~AnalysisSettings", childCount: 1 },
      { id: 2, name: "+AnalysisWorkspaces", childCount: 1 },
      { id: 3, name: "SolHunt", childCount: 1 },
    ],
  });

  expect(tree.root.children.slice(0, 3)).toEqual([
    "project-2",
    "project-3",
    "project-1",
  ]);
  expect(codePointNameCompare("+AnalysisWorkspaces", "~AnalysisSettings")).toBeLessThan(0);
});
