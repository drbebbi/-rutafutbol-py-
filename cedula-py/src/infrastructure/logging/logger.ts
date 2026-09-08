import { redactForLog, type LogRecord } from "./redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSink = (level: LogLevel, record: LogRecord) => void;

const defaultSink: LogSink = (level, record) => {
  const line = JSON.stringify({ level, ...record });
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
};

/**
 * The only logger the application uses.
 *
 * Every record passes through the allowlist, so there is no code path that can
 * write a user's wizard answers to a log, however the call site is written.
 */
export function createLogger(sink: LogSink = defaultSink) {
  const write = (level: LogLevel, record: LogRecord): void => {
    sink(level, redactForLog(record));
  };
  return {
    debug: (record: LogRecord) => write("debug", record),
    info: (record: LogRecord) => write("info", record),
    warn: (record: LogRecord) => write("warn", record),
    error: (record: LogRecord) => write("error", record),
  };
}

export type Logger = ReturnType<typeof createLogger>;

/**
 * What the browser is allowed to learn about a server failure.
 *
 * A correlation id lets support find the real error; the stack trace, the SQL
 * and the internal message stay on the server.
 */
export type ClientSafeError = Readonly<{
  code: string;
  message: string;
  correlationId: string;
}>;

export function toClientSafeError(code: string, correlationId: string): ClientSafeError {
  return {
    code,
    message: "The request could not be completed. Please try again.",
    correlationId,
  };
}
