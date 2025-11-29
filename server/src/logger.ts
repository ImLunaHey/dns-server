type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m',
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m', // Green
  warn: '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
  timestamp: '\x1b[90m', // Gray
  context: '\x1b[90m', // Gray
};

class Logger {
  private minLevel: LogLevel;
  private useJSON: boolean;
  private supportsColor: boolean;

  constructor() {
    // Get log level from environment or default to 'info'
    const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
    const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    this.minLevel = validLevels.includes(envLevel) ? envLevel : 'info';

    // Use JSON format in production, readable format in development
    this.useJSON = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';

    // Check if terminal supports color (not in CI or when explicitly disabled)
    this.supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== '0';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level] >= levels[this.minLevel];
  }

  private formatTimestamp(): string {
    if (this.useJSON) {
      return new Date().toISOString();
    }

    // Human-readable format for development (fixed width: 12 characters)
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const ms = now.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`.padEnd(12);
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): string {
    if (this.useJSON) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
      };

      if (context) {
        entry.context = context;
      }

      if (error) {
        entry.error = {
          message: error.message,
          stack: error.stack,
          name: error.name,
        };
      }

      return JSON.stringify(entry);
    }

    // Human-readable format for development with colors
    const timestamp = this.formatTimestamp();
    const levelColor = this.supportsColor ? colors[level] : '';
    const reset = this.supportsColor ? colors.reset : '';
    const timestampColor = this.supportsColor ? colors.timestamp : '';
    const contextColor = this.supportsColor ? colors.context : '';

    // Fixed-width spacing: timestamp (12 chars) + 1 space + level (5 chars, includes trailing space) + message
    const levelUpper = level.toUpperCase().padEnd(5);
    // Build output - level already has trailing space from padEnd, so no extra space needed
    let output = `${timestampColor}${timestamp}${reset} ${levelColor}${levelUpper}${reset}${message}`;

    if (context && Object.keys(context).length > 0) {
      // Format context as key=value pairs in gray
      const contextPairs = Object.entries(context)
        .map(([key, value]) => {
          const formattedValue = typeof value === 'string' ? value : JSON.stringify(value);
          return `${key}=${formattedValue}`;
        })
        .join(' ');
      output += ` ${contextColor}${contextPairs}${reset}`;
    }

    if (error) {
      const errorColor = this.supportsColor ? colors.error : '';
      output += `\n${errorColor}  Error: ${error.message}${reset}`;
      if (error.stack) {
        const stackLines = error.stack.split('\n').slice(1, 4);
        output += `\n${timestampColor}  ${stackLines.join(`\n${timestampColor}  `)}${reset}`;
      }
    }

    return output;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context, error));
    }
  }
}

export const logger = new Logger();
