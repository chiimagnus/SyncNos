declare const __SYNCNOSCLI_VERSION__: string;

const HELP = `SyncNos CLI\n\nUsage:\n  syncnoscli --help\n  syncnoscli --version\n`;

export function runCli(argv = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${__SYNCNOSCLI_VERSION__}\n`);
    return 0;
  }

  process.stderr.write(`Unknown command: ${argv[0]}\nRun syncnoscli --help for usage.\n`);
  return 2;
}

if (require.main === module) {
  process.exitCode = runCli();
}
