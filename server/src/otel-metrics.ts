import {
  MeterProvider,
  PeriodicExportingMetricReader,
  MetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import type { BatchObservableResult } from '@opentelemetry/api';
// @ts-expect-error - resourceFromAttributes exists at runtime but types may be incomplete
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
// Using proto exporter for protobuf encoding (required by Axiom and other backends)
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { logger } from './logger.js';
import { dbSettings } from './db.js';

// ExportResult type from SDK
type ExportResult = {
  code: number;
  error?: Error;
};

type OtelConfig = {
  enabled: boolean;
  exporterType: 'otlp' | 'prometheus';
  endpoint: string;
  headers?: Record<string, string>;
  prometheusPort?: number;
};

let meterProvider: MeterProvider | null = null;
let prometheusExporter: PrometheusExporter | null = null;

/**
 * Wrapper around OTLPMetricExporter to add logging and error handling
 */
class LoggingOTLPMetricExporter extends OTLPMetricExporter {
  private exportCount = 0;
  private successCount = 0;
  private failureCount = 0;
  private lastError: Error | undefined = undefined;
  private endpoint: string;

  private headers: Record<string, string>;

  constructor(config: { url: string; headers?: Record<string, string> }) {
    super(config);
    this.endpoint = config.url;
    this.headers = config.headers || {};

    // Log headers on construction (masking sensitive values)
    const maskedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.headers)) {
      if (key.toLowerCase() === 'authorization') {
        maskedHeaders[key] = value.substring(0, 10) + '...' + (value.length > 10 ? ` (length: ${value.length})` : '');
      } else {
        maskedHeaders[key] = value;
      }
    }
    logger.debug('LoggingOTLPMetricExporter initialized', {
      endpoint: this.endpoint,
      headers: maskedHeaders,
      headerCount: Object.keys(this.headers).length,
    });
  }

  override async export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): Promise<void> {
    this.exportCount++;
    const startTime = Date.now();

    logger.debug('OpenTelemetry metrics export starting', {
      exportCount: this.exportCount,
      metricCount: metrics.scopeMetrics?.length || 0,
      resourceAttributes: Object.keys(metrics.resource?.attributes || {}),
    });

    // Log details about what metrics are being exported
    if (metrics.scopeMetrics && metrics.scopeMetrics.length > 0) {
      const metricDetails: string[] = [];
      const metricDataPoints: Array<{ name: string; type: string; dataPoints: number }> = [];

      for (const scopeMetric of metrics.scopeMetrics) {
        if (scopeMetric.metrics) {
          for (const metric of scopeMetric.metrics) {
            metricDetails.push(metric.descriptor.name);

            // Count data points for each metric
            let dataPointCount = 0;
            if ('dataPoints' in metric && Array.isArray(metric.dataPoints)) {
              dataPointCount = metric.dataPoints.length;
            }

            metricDataPoints.push({
              name: metric.descriptor.name,
              type: metric.descriptor.type || 'unknown',
              dataPoints: dataPointCount,
            });
          }
        }
      }

      logger.info('OpenTelemetry metrics being exported', {
        metricNames: metricDetails,
        totalMetrics: metricDetails.length,
        metricDetails: metricDataPoints,
        datasetHeader: this.headers['x-axiom-metrics-dataset'] || this.headers['X-Axiom-Metrics-Dataset'] || 'NOT SET',
        allHeaders: Object.keys(this.headers),
      });
    }

    try {
      await super.export(metrics, (result: ExportResult) => {
        const duration = Date.now() - startTime;

        if (result.code === 0) {
          // SUCCESS
          this.successCount++;

          // Count total data points being sent
          let totalDataPoints = 0;
          if (metrics.scopeMetrics) {
            for (const scopeMetric of metrics.scopeMetrics) {
              if (scopeMetric.metrics) {
                for (const metric of scopeMetric.metrics) {
                  if ('dataPoints' in metric && Array.isArray(metric.dataPoints)) {
                    totalDataPoints += metric.dataPoints.length;
                  }
                }
              }
            }
          }

          logger.info('OpenTelemetry metrics export succeeded', {
            exportCount: this.exportCount,
            successCount: this.successCount,
            failureCount: this.failureCount,
            duration: `${duration}ms`,
            metricCount: metrics.scopeMetrics?.length || 0,
            totalDataPoints,
            dataset: this.headers['x-axiom-metrics-dataset'] || this.headers['X-Axiom-Metrics-Dataset'] || 'NOT SET',
            endpoint: this.endpoint,
          });
        } else {
          // FAILURE
          this.failureCount++;
          const errorMessage = result.error?.message || 'Unknown error';
          this.lastError = result.error || new Error(errorMessage);
          // Log headers being used (masked)
          const maskedHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(this.headers)) {
            if (key.toLowerCase() === 'authorization') {
              maskedHeaders[key] = value.substring(0, 15) + '...' + (value.length > 15 ? ` (length: ${value.length})` : '');
            } else {
              maskedHeaders[key] = value;
            }
          }

          logger.error('OpenTelemetry metrics export failed', {
            exportCount: this.exportCount,
            successCount: this.successCount,
            failureCount: this.failureCount,
            duration: `${duration}ms`,
            errorCode: result.code,
            errorMessage,
            error: this.lastError,
            endpoint: this.endpoint,
            headersUsed: maskedHeaders,
            authHeaderPresent: !!(this.headers.Authorization || this.headers.authorization),
            authHeaderFormat: this.headers.Authorization?.startsWith('Bearer ')
              ? 'Bearer'
              : this.headers.Authorization?.startsWith('xaat-')
              ? 'xaat'
              : 'unknown',
          });
        }

        resultCallback(result);
      });
    } catch (error) {
      this.failureCount++;
      this.lastError = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;
      logger.error('OpenTelemetry metrics export exception', {
        exportCount: this.exportCount,
        successCount: this.successCount,
        failureCount: this.failureCount,
        duration: `${duration}ms`,
        error: this.lastError,
      });

      resultCallback({
        code: 1, // ERROR
        error: this.lastError,
      });
    }
  }

  override async shutdown(): Promise<void> {
    logger.debug('OpenTelemetry metrics exporter shutting down', {
      totalExports: this.exportCount,
      successCount: this.successCount,
      failureCount: this.failureCount,
      lastError: this.lastError?.message || undefined,
    });
    return super.shutdown();
  }
}

/**
 * Initialize OpenTelemetry metrics
 */
export function initializeOtelMetrics(config: OtelConfig): void {
  if (!config.enabled) {
    logger.info('OpenTelemetry metrics disabled');
    shutdownOtelMetrics();
    return;
  }

  try {
    // Create resource with service information
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'dns-server',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    });

    const readers: MetricReader[] = [];

    if (config.exporterType === 'prometheus') {
      // Prometheus exporter
      const port = config.prometheusPort || 9464;
      prometheusExporter = new PrometheusExporter(
        {
          port,
          endpoint: '/metrics',
        },
        () => {
          logger.info(`Prometheus metrics endpoint started on port ${port}`);
        },
      );

      readers.push(prometheusExporter as unknown as MetricReader);
    } else {
      // OTLP exporter with protobuf encoding (application/x-protobuf)
      // This is required by Axiom and other backends that don't support JSON

      // Normalize headers - ensure Authorization header is properly formatted
      const normalizedHeaders: Record<string, string> = { ...(config.headers || {}) };

      // Check if Authorization header exists and normalize it
      if (normalizedHeaders.Authorization || normalizedHeaders.authorization) {
        const authValue = normalizedHeaders.Authorization || normalizedHeaders.authorization;
        // Remove old header (case-insensitive)
        delete normalizedHeaders.Authorization;
        delete normalizedHeaders.authorization;

        // Axiom tokens starting with "xaat-" are personal API tokens and should NOT have "Bearer " prefix
        // Other tokens should have "Bearer " prefix
        if (authValue && !authValue.startsWith('Bearer ') && !authValue.startsWith('bearer ')) {
          if (authValue.startsWith('xaat-')) {
            // Axiom personal API token - use as-is without Bearer prefix
            normalizedHeaders.Authorization = authValue;
            logger.debug('Using Axiom token without Bearer prefix', {
              tokenPrefix: authValue.substring(0, 20) + '...',
            });
          } else {
            // Other tokens - add Bearer prefix
            normalizedHeaders.Authorization = `Bearer ${authValue}`;
            logger.debug('Normalized Authorization header with Bearer prefix', {
              original: authValue.substring(0, 20) + '...',
              normalized: `Bearer ${authValue.substring(0, 20)}...`,
            });
          }
        } else {
          normalizedHeaders.Authorization = authValue;
        }
      }

      // Wrap with logging exporter
      const exporter = new LoggingOTLPMetricExporter({
        url: config.endpoint || 'http://localhost:4318/v1/metrics',
        headers: normalizedHeaders,
      });

      // Log headers with masked values
      const maskedHeaders: Record<string, string> = {};
      if (config.headers) {
        for (const [key, value] of Object.entries(config.headers)) {
          if (key.toLowerCase() === 'authorization') {
            maskedHeaders[key] = value.substring(0, 15) + '...' + (value.length > 15 ? ` (length: ${value.length})` : '');
          } else {
            maskedHeaders[key] = value;
          }
        }
      }

      logger.info('OpenTelemetry OTLP exporter configuration', {
        endpoint: config.endpoint,
        headers: maskedHeaders,
        headerKeys: Object.keys(config.headers || {}),
        hasAuth: !!(config.headers?.Authorization || config.headers?.authorization),
        authFormat: config.headers?.Authorization?.startsWith('Bearer ')
          ? 'Bearer'
          : config.headers?.Authorization?.startsWith('xaat-')
          ? 'xaat'
          : 'unknown',
      });

      const metricReader = new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 10000, // Export every 10 seconds
      });

      // Log export events periodically (every export interval)
      let exportCycleCount = 0;
      setInterval(() => {
        if (meterProvider) {
          exportCycleCount++;
          logger.debug('OpenTelemetry metrics export cycle check', {
            endpoint: config.endpoint,
            exportCycleCount,
            interval: '10s',
            meterProviderInitialized: !!meterProvider,
          });
        }
      }, 10000);

      readers.push(metricReader);
    }

    meterProvider = new MeterProvider({
      resource,
      readers,
    });

    logger.info('OpenTelemetry metrics initialized', {
      exporterType: config.exporterType,
      endpoint:
        config.exporterType === 'otlp' ? config.endpoint : `http://localhost:${config.prometheusPort || 9464}/metrics`,
    });
  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry metrics', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

/**
 * Shutdown OpenTelemetry metrics
 */
export function shutdownOtelMetrics(): void {
  if (meterProvider) {
    meterProvider.shutdown().catch((error: unknown) => {
      logger.error('Error shutting down OpenTelemetry metrics', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });
    meterProvider = null;
  }
  prometheusExporter = null;
}

/**
 * Get the meter provider (creates one if not initialized)
 */
export function getMeterProvider(): MeterProvider | null {
  if (!meterProvider) {
    // Try to initialize from settings
    const enabled = dbSettings.get('otelEnabled', 'false') === 'true';
    if (enabled) {
      const config: OtelConfig = {
        enabled: true,
        exporterType: dbSettings.get('otelExporterType', 'otlp') as 'otlp' | 'prometheus',
        endpoint: dbSettings.get('otelEndpoint', 'http://localhost:4318/v1/metrics'),
        prometheusPort: parseInt(dbSettings.get('otelPrometheusPort', '9464'), 10),
      };

      // Parse headers if present
      const headersStr = dbSettings.get('otelHeaders', '');
      if (headersStr) {
        try {
          config.headers = JSON.parse(headersStr);
        } catch {
          // Ignore parse errors
        }
      }

      initializeOtelMetrics(config);
    }
  }
  return meterProvider;
}

/**
 * Get or create a meter
 */
export function getMeter(name: string, version?: string) {
  const provider = getMeterProvider();
  if (!provider) {
    return null;
  }
  return provider.getMeter(name, version);
}

/**
 * Record DNS query metrics
 */
// Cache for metric instruments to avoid recreating them
const metricInstruments = new Map<string, unknown>();

export function recordDNSQuery(attributes: {
  domain?: string;
  type?: string;
  blocked: boolean;
  cached: boolean;
  blockReason?: string;
  rcode?: number;
  responseTime?: number;
  clientIp?: string;
}): void {
  const meter = getMeter('dns-server', '1.0.0');
  if (!meter) {
    return;
  }

  try {
    // Get or create counters and histograms
    const queryCounterKey = 'dns.queries.total';
    const blockedCounterKey = 'dns.queries.blocked';
    const cachedCounterKey = 'dns.queries.cached';
    const responseTimeHistogramKey = 'dns.query.response_time';

    let queryCounter = metricInstruments.get(queryCounterKey) as ReturnType<typeof meter.createCounter> | undefined;
    if (!queryCounter) {
      queryCounter = meter.createCounter(queryCounterKey, {
        description: 'Total number of DNS queries',
      });
      metricInstruments.set(queryCounterKey, queryCounter);
      logger.debug('Created OpenTelemetry counter', { name: queryCounterKey });
    }

    let blockedCounter = metricInstruments.get(blockedCounterKey) as ReturnType<typeof meter.createCounter> | undefined;
    if (!blockedCounter) {
      blockedCounter = meter.createCounter(blockedCounterKey, {
        description: 'Number of blocked DNS queries',
      });
      metricInstruments.set(blockedCounterKey, blockedCounter);
      logger.debug('Created OpenTelemetry counter', { name: blockedCounterKey });
    }

    let cachedCounter = metricInstruments.get(cachedCounterKey) as ReturnType<typeof meter.createCounter> | undefined;
    if (!cachedCounter) {
      cachedCounter = meter.createCounter(cachedCounterKey, {
        description: 'Number of cached DNS queries',
      });
      metricInstruments.set(cachedCounterKey, cachedCounter);
      logger.debug('Created OpenTelemetry counter', { name: cachedCounterKey });
    }

    let responseTimeHistogram = metricInstruments.get(responseTimeHistogramKey) as
      | ReturnType<typeof meter.createHistogram>
      | undefined;
    if (!responseTimeHistogram) {
      responseTimeHistogram = meter.createHistogram(responseTimeHistogramKey, {
        description: 'DNS query response time in milliseconds',
        unit: 'ms',
      });
      metricInstruments.set(responseTimeHistogramKey, responseTimeHistogram);
      logger.debug('Created OpenTelemetry histogram', { name: responseTimeHistogramKey });
    }

    const queryAttributes: Record<string, string | number> = {};
    if (attributes.type) queryAttributes['dns.query.type'] = attributes.type;
    if (attributes.blockReason) queryAttributes['dns.block.reason'] = attributes.blockReason;
    if (attributes.rcode !== undefined) queryAttributes['dns.response.code'] = attributes.rcode;

    // Record total queries
    queryCounter.add(1, queryAttributes);

    // Record blocked queries
    if (attributes.blocked) {
      blockedCounter.add(1, queryAttributes);
    }

    // Record cached queries
    if (attributes.cached) {
      cachedCounter.add(1, queryAttributes);
    }

    // Record response time
    if (attributes.responseTime !== undefined) {
      responseTimeHistogram.record(attributes.responseTime, queryAttributes);
    }

    // Only log occasionally to avoid spam (every 100th query)
    if (Math.random() < 0.01) {
      logger.debug('Sample DNS query metrics recorded', {
        domain: attributes.domain,
        type: attributes.type,
        blocked: attributes.blocked,
        cached: attributes.cached,
      });
    }
  } catch (error) {
    logger.error('Error recording DNS query metrics', {
      error: error instanceof Error ? error : new Error(String(error)),
      attributes,
    });
  }
}

/**
 * Record cache metrics
 */
export function recordCacheMetrics(operation: 'hit' | 'miss' | 'set' | 'evict', domain?: string, type?: string): void {
  const meter = getMeter('dns-server', '1.0.0');
  if (!meter) return;

  try {
    const cacheCounterKey = 'dns.cache.operations';
    let cacheCounter = metricInstruments.get(cacheCounterKey) as ReturnType<typeof meter.createCounter> | undefined;
    if (!cacheCounter) {
      cacheCounter = meter.createCounter(cacheCounterKey, {
        description: 'DNS cache operations',
      });
      metricInstruments.set(cacheCounterKey, cacheCounter);
    }

    const attributes: Record<string, string> = {
      'cache.operation': operation,
    };
    if (domain) attributes['dns.query.domain'] = domain;
    if (type) attributes['dns.query.type'] = type;

    cacheCounter.add(1, attributes);
  } catch (error) {
    logger.error('Error recording cache metrics', {
      error: error instanceof Error ? error : new Error(String(error)),
      operation,
      domain,
      type,
    });
  }
}

/**
 * Record upstream DNS metrics
 */
export function recordUpstreamMetrics(attributes: {
  upstream: string;
  success: boolean;
  responseTime?: number;
  queryType?: string;
}): void {
  const meter = getMeter('dns-server', '1.0.0');
  if (!meter) return;

  try {
    const upstreamCounterKey = 'dns.upstream.queries';
    const upstreamErrorsCounterKey = 'dns.upstream.errors';
    const upstreamResponseTimeHistogramKey = 'dns.upstream.response_time';

    let upstreamCounter = metricInstruments.get(upstreamCounterKey) as ReturnType<typeof meter.createCounter> | undefined;
    if (!upstreamCounter) {
      upstreamCounter = meter.createCounter(upstreamCounterKey, {
        description: 'Number of upstream DNS queries',
      });
      metricInstruments.set(upstreamCounterKey, upstreamCounter);
    }

    let upstreamErrorsCounter = metricInstruments.get(upstreamErrorsCounterKey) as
      | ReturnType<typeof meter.createCounter>
      | undefined;
    if (!upstreamErrorsCounter) {
      upstreamErrorsCounter = meter.createCounter(upstreamErrorsCounterKey, {
        description: 'Number of upstream DNS errors',
      });
      metricInstruments.set(upstreamErrorsCounterKey, upstreamErrorsCounter);
    }

    let upstreamResponseTimeHistogram = metricInstruments.get(upstreamResponseTimeHistogramKey) as
      | ReturnType<typeof meter.createHistogram>
      | undefined;
    if (!upstreamResponseTimeHistogram) {
      upstreamResponseTimeHistogram = meter.createHistogram(upstreamResponseTimeHistogramKey, {
        description: 'Upstream DNS response time in milliseconds',
        unit: 'ms',
      });
      metricInstruments.set(upstreamResponseTimeHistogramKey, upstreamResponseTimeHistogram);
    }

    const queryAttributes: Record<string, string | number> = {
      'dns.upstream.server': attributes.upstream,
    };
    if (attributes.queryType) queryAttributes['dns.query.type'] = attributes.queryType;

    upstreamCounter.add(1, queryAttributes);

    if (!attributes.success) {
      upstreamErrorsCounter.add(1, queryAttributes);
    }

    if (attributes.responseTime !== undefined) {
      upstreamResponseTimeHistogram.record(attributes.responseTime, queryAttributes);
    }

    // Upstream metrics logged less frequently to avoid spam
  } catch (error) {
    logger.error('Error recording upstream metrics', {
      error: error instanceof Error ? error : new Error(String(error)),
      attributes,
    });
  }
}

/**
 * Record rate limit metrics
 */
export function recordRateLimitMetrics(clientIp: string, blocked: boolean): void {
  const meter = getMeter('dns-server', '1.0.0');
  if (!meter) return;

  try {
    const rateLimitCounterKey = 'dns.rate_limit.actions';
    let rateLimitCounter = metricInstruments.get(rateLimitCounterKey) as ReturnType<typeof meter.createCounter> | undefined;
    if (!rateLimitCounter) {
      rateLimitCounter = meter.createCounter(rateLimitCounterKey, {
        description: 'Rate limit actions',
      });
      metricInstruments.set(rateLimitCounterKey, rateLimitCounter);
    }

    rateLimitCounter.add(1, {
      'rate_limit.action': blocked ? 'blocked' : 'allowed',
    });
  } catch (error) {
    logger.error('Error recording rate limit metrics', {
      error: error instanceof Error ? error : new Error(String(error)),
      clientIp,
      blocked,
    });
  }
}

/**
 * Record server metrics
 */
export function recordServerMetrics(attributes: { uptime?: number; totalQueries?: number; errorCount?: number }): void {
  const meter = getMeter('dns-server', '1.0.0');
  if (!meter) return;

  try {
    if (attributes.uptime !== undefined) {
      const uptimeGauge = meter.createObservableGauge('dns.server.uptime', {
        description: 'Server uptime in seconds',
        unit: 's',
      });

      meter.addBatchObservableCallback(
        (observableResult: BatchObservableResult) => {
          observableResult.observe(uptimeGauge, attributes.uptime || 0);
        },
        [uptimeGauge],
      );
    }

    if (attributes.totalQueries !== undefined) {
      const queryGauge = meter.createObservableGauge('dns.server.total_queries', {
        description: 'Total number of queries processed',
      });

      meter.addBatchObservableCallback(
        (observableResult: BatchObservableResult) => {
          observableResult.observe(queryGauge, attributes.totalQueries || 0);
        },
        [queryGauge],
      );
    }

    if (attributes.errorCount !== undefined) {
      const errorGauge = meter.createObservableGauge('dns.server.errors', {
        description: 'Total number of errors',
      });

      meter.addBatchObservableCallback(
        (observableResult: BatchObservableResult) => {
          observableResult.observe(errorGauge, attributes.errorCount || 0);
        },
        [errorGauge],
      );
    }
  } catch (error) {
    logger.debug('Error recording server metrics', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

/**
 * Get Prometheus metrics endpoint handler (if using Prometheus exporter)
 * @param request Incoming HTTP request
 * @param response Server response
 */
export function getPrometheusMetrics(request: unknown, response: unknown): void {
  if (prometheusExporter) {
    prometheusExporter.getMetricsRequestHandler(
      request as Parameters<typeof prometheusExporter.getMetricsRequestHandler>[0],
      response as Parameters<typeof prometheusExporter.getMetricsRequestHandler>[1],
    );
  }
}
