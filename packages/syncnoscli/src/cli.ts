import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LocalDataContractError,
  createCliJsonFailure,
  createCliJsonSuccess,
} from '@services/local-data/contracts';

import { runDoctor, type RunDoctorInput } from './commands/doctor';

declare const __SYNCNOSCLI_VERSION__: string;

const HELP = `SyncNos CLI\n\nUsage:\n  syncnoscli --help\n  syncnoscli --version\n  syncnoscli doctor [--fix]\n\nProtocol envelope: v${LOCAL_DATA_PROTOCOL_VERSION}\n`;

type CliOutput = Readonly<{ write: (chunk: string) => boolean }>;

export type RunCliInput = Readonly<{
  runDoctor?: (input: RunDoctorInput) => Promise<unknown>;
  stderr?: CliOutput;
  stdout?: CliOutput;
}>;

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function doctorArguments(argv: readonly string[]): Readonly<{ fix: boolean }> | null {
  if (argv.length === 0) return Object.freeze({ fix: false });
  if (argv.length === 1 && argv[0] === '--fix') return Object.freeze({ fix: true });
  return null;
}

export async function runCli(argv = process.argv.slice(2), input: RunCliInput = {}): Promise<number> {
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    stdout.write(HELP);
    return 0;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    stdout.write(`${__SYNCNOSCLI_VERSION__}\n`);
    return 0;
  }

  if (argv[0] === 'doctor') {
    const options = doctorArguments(argv.slice(1));
    if (!options) {
      stdout.write(json(createCliJsonFailure('cli:doctor', 'INVALID_ARGUMENT')));
      return 2;
    }
    try {
      stdout.write(json(createCliJsonSuccess('cli:doctor', await (input.runDoctor ?? runDoctor)(options))));
      return 0;
    } catch (error) {
      stdout.write(
        json(
          createCliJsonFailure('cli:doctor', error instanceof LocalDataContractError ? error.code : 'INVALID_ARGUMENT'),
        ),
      );
      return 1;
    }
  }

  stderr.write(`Unknown command: ${argv[0]}\nRun syncnoscli --help for usage.\n`);
  return 2;
}

if (require.main === module) {
  void runCli().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
