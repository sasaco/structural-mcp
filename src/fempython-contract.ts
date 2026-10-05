export const femPythonPdfSections = [
  "input",
  "section_force",
  "pickup_section_force",
  "displacement",
  "pickup_displacement",
] as const;

export const femPythonRunnerContract = {
  protocolVersion: 1,
  engine: "fempython",
  inputFormat: "FrameWebforCS saved document JSON; existing results are not reused",
  command: "run",
  arguments: ["--input", "<absolute JSON path>", "--output-dir", "<empty directory>"],
  optionalArguments: {
    "--generate-pdf": { values: ["true", "false"], default: "true" },
    "--generate-pik": { values: ["true", "false"], default: "true" },
    "--generate-pickup-displacement-csv": { values: ["true", "false"], default: "false" },
    "--generate-pickup-reaction-csv": { values: ["true", "false"], default: "false" },
    "--pdf-sections": { format: "comma-separated", values: femPythonPdfSections, default: femPythonPdfSections.join(",") },
  },
  artifacts: [
    { name: "result.json", mediaType: "application/json", required: true },
    { name: "pickup.pik", mediaType: "text/plain; charset=utf-8", when: "generatePik=true (2D only)" },
    { name: "report.pdf", mediaType: "application/pdf", when: "generatePdf=true" },
    { name: "pickup-displacement.csv", mediaType: "text/csv; charset=utf-8", when: "generatePickupDisplacementCsv=true (2D/3D)" },
    { name: "pickup-reaction.csv", mediaType: "text/csv; charset=utf-8", when: "generatePickupReactionCsv=true (2D/3D)" },
  ],
  pickupNodeCsv: {
    encoding: "UTF-8 without BOM",
    identityColumns: ["pickup_id", "focus_component", "node_id", "max_combine_id", "min_combine_id"],
    valueColumns: "max_<component> (<unit>) for all six components, then min_<component> (<unit>) for all six components",
    displacement: {
      components: ["dx", "dy", "dz", "rx", "ry", "rz"],
      units: ["length", "length", "length", "rad", "rad", "rad"],
      focus2D: ["dx", "dy", "rz"],
    },
    reaction: {
      components: ["fx", "fy", "fz", "mx", "my", "mz"],
      units: ["force", "force", "force", "force*length", "force*length", "force*length"],
      focus2D: ["fx", "fy", "mz"],
    },
    focus3D: "All six components in component order",
    rowOrder: ["PICKUP definition order", "focus component order", "topology node order"],
    unitSource: "Substitute analysisResultSet.units.length/force; retain unspecified if the analysis metadata does not name a unit",
    values: "Unrounded analysis values in the units stated in the headers; rotations in rad",
    selection: "Signed max/min with their source COMBINE IDs and all six correlated components; reactions contain support nodes only",
    csvOnly: "Set generatePik=false and generatePdf=false; each CSV flag is independent and defaults to false",
  },
  runtime: [
    "Windows x64 / .NET 10 Desktop Runtime; build FrameWebforCS/Headless/FrameWebforCS.Headless.csproj in Release",
    "Keep runner under the FEMPython checkout with FrameWeb/src and the uv-managed FrameWeb/.venv",
    "Run uv sync --project FrameWeb --locked from the FEMPython directory before use",
    "No window or interactive print dialog is opened",
  ],
  resultHandling: [
    "stdout is one UTF-8 protocol v1 JSON envelope; logs use stderr",
    "Require exit code 0, ok=true and executionStatus=success before using artifacts",
    "engineeringStatus is separate from process success; analysis is not a design verification",
    "Verify artifact relative paths, byte counts and SHA-256 before placing them at client-selected destinations",
  ],
  mcpWorkflow: [
    "Read the document in the client and pass its JSON string as fempython_calculate.input",
    "Use read_artifact with jobId and artifactId; concatenate Base64-decoded chunks by offsetBytes",
    "Verify total bytes and SHA-256 against the calculation response, then save at the requested client path",
    "Client input/output folders need not be registered with the MCP server when input is passed inline",
  ],
};
