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
    "--pdf-sections": { format: "comma-separated", values: femPythonPdfSections, default: femPythonPdfSections.join(",") },
  },
  artifacts: [
    { name: "result.json", mediaType: "application/json", required: true },
    { name: "pickup.pik", mediaType: "text/plain; charset=utf-8", when: "generatePik=true (2D only)" },
    { name: "report.pdf", mediaType: "application/pdf", when: "generatePdf=true" },
  ],
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
