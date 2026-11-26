export interface SpawnSpec {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface PtySpawnSpec extends SpawnSpec {
  readonly cols?: number;
  readonly rows?: number;
  readonly term?: string;
}

export interface ProcessExitResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface ManagedProcess {
  readonly pid?: number;
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<ProcessExitResult>;
  /** Bounded redacted stderr tail (e.g. 8 KiB) retained regardless of consumer reads. */
  getStderrTail(): string;
  killTree(graceMs?: number): Promise<void>;
}

export interface ManagedPty {
  readonly pid?: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (chunk: string) => void): () => void;
  readonly exited: Promise<ProcessExitResult>;
  killTree(graceMs?: number): Promise<void>;
}

export interface SandboxLifecycle {
  connect(signal?: AbortSignal): Promise<void>;
  ensureAlive(signal?: AbortSignal): Promise<void>;
  suspend(signal?: AbortSignal): Promise<void>;
  destroy(signal?: AbortSignal): Promise<void>;
}

export interface ExecutionRuntime {
  readonly id: string;
  readonly platform: 'darwin' | 'linux' | 'win32';
  readonly kind: 'local' | 'wsl' | 'ssh' | 'container' | 'cloud-sandbox';
  readonly defaultCwd: string;
  readonly lifecycle?: SandboxLifecycle;

  spawn(spec: SpawnSpec, signal?: AbortSignal): Promise<ManagedProcess>;
  spawnPty?(spec: PtySpawnSpec, signal?: AbortSignal): Promise<ManagedPty>;

  which(command: string, env?: Readonly<Record<string, string>>): Promise<string | null>;
  realpath(targetPath: string): Promise<string>;
  exists(targetPath: string): Promise<boolean>;
  mkdir(targetPath: string, options?: { readonly recursive?: boolean }): Promise<void>;
  readdir(targetPath: string): Promise<ReadonlyArray<{ readonly name: string; readonly isDirectory: boolean }>>;
  readFile(targetPath: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(targetPath: string, content: string): Promise<void>;
  stat(targetPath: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number } | null>;
  mapHostPathToRuntime?(hostPath: string): string;
}
