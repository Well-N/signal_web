import path from "node:path";

export function runnerCommand(root: string, command: string, python: string) {
  const packaged = process.env.SIGNALWEB_RUNNER;
  if (packaged) return { executable: packaged, args: [command] };
  return {
    executable: python,
    args: [path.join(root, "scripts", "signalweb_runner.py"), command],
  };
}
