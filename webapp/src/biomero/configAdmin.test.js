import { getDeletedConfigOptions, validateWorkflowRows } from "./configAdmin";


test("finds explicit deletions across arbitrary flat config sections", () => {
  const previous = {
    SLURM: { keep: "value", remove: "value" },
    ANALYTICS: { remove_too: "true" },
    WORKFLOWS: {
      cellpose: "cellpose",
      cellpose_repo: "https://example.test/cellpose",
      cellpose_job: "jobs/cellpose.sh",
    },
  };
  const next = {
    SLURM: { keep: "value" },
    ANALYTICS: {},
    WORKFLOWS: {},
  };

  expect(getDeletedConfigOptions(previous, next)).toEqual([
    { section: "SLURM", option: "remove" },
    { section: "ANALYTICS", option: "remove_too" },
    { section: "WORKFLOWS", option: "cellpose" },
    { section: "WORKFLOWS", option: "cellpose_repo" },
    { section: "WORKFLOWS", option: "cellpose_job" },
  ]);
});

test.each([
  { name: "", repo: "", job: "" },
  { name: "Bad Name", repo: "https://github.com/example/wf", job: "jobs/wf.sh" },
  { name: "wf", repo: "https://example.org/wf", job: "jobs/wf.sh" },
  { name: "wf", repo: "https://github.com/example/wf/tree/", job: "jobs/wf.sh" },
  { name: "wf", repo: "https://github.com/example/wf", job: "jobs/wf.sh\n=" },
])("rejects malformed workflow rows before serialization: %j", (row) => {
  expect(validateWorkflowRows([row])[0]).toBeDefined();
});

test("accepts supported workflow names and versioned repositories", () => {
  expect(validateWorkflowRows([{
    name: "wf_name-2", repo: "https://github.com/example/wf/tree/v2.0", job: "jobs/wf.sh",
  }])).toEqual({});
});
