
import debugFn from 'debug';
import { EventEmitter } from 'events';
import kindOf from 'kind-of';
import path from 'path';
import * as i from './interfaces';
import { random, isString, uniq } from './utils';
import { isFunction } from 'util';

interface DebugParamObj {
    module: string;
    assignment?: string;
    [name: string]: any;
}

function newId(prefix: string): string {
    return `${prefix}-${random(10000, 99999)}`;
}

type debugParam = DebugParamObj | string;

export function debugLogger(testName: string, param?: debugParam, otherName?: string): i.Logger {
    const logger: i.Logger = new EventEmitter() as i.Logger;

    const parts: string[] = ['teraslice', testName];
    if (param) {
        if (isString(param)) {
            parts.push(param as string);
        } else if (typeof param === 'object') {
            parts.push(param.module);
            if (param.assignment) {
                parts.push(param.assignment);
            }
        }
    }
    const name = uniq(parts).join(':');

    if (otherName) {
        parts.push(otherName);
    }

    logger.streams = [];

    logger.addStream = function (stream) {
        // @ts-ignore
        this.streams.push(stream);
    };

    logger.child = (opts: debugParam) => debugLogger(testName, opts);
    logger.flush = () => Promise.resolve();
    logger.reopenFileStreams = () => {};
    logger.level = () => 50;
    // @ts-ignore
    logger.levels = () => 50;

    logger.src = false;

    const levels = [
        'trace',
        'debug',
        'info',
        'warn',
        'error',
        'fatal'
    ];

    for (const level of levels) {
        const fLevel = `[${level.toUpperCase()}]`;
        const debug = debugFn(name);
        logger[level] = (...args: any[]) => {
            debug(fLevel, ...args);
        };
    }

    return logger;
}

export function newTestSlice(request: i.SliceRequest = {}): i.Slice {
    return {
        slice_id: newId('slice-id'),
        slicer_id: random(0, 99999),
        slicer_order: random(0, 99999),
        request,
        _created: new Date().toISOString(),
    };
}

const defaultJobConfig = { name: 'test-job', operations: [] };

export function newTestJobConfig(defaults: i.JobConfig = defaultJobConfig): i.ValidatedJobConfig {
    return Object.assign({
        analytics: false,
        assets: [],
        lifecycle: i.LifeCycle.Once,
        max_retries: 0,
        probation_window: 30000,
        recycle_worker: 0,
        slicers: 1,
        workers: 1,
    }, defaults);
}

export function newTestExecutionConfig(jobConfig?: i.JobConfig): i.ExecutionConfig {
    const exConfig = (jobConfig || newTestJobConfig()) as i.ExecutionConfig;
    exConfig.slicer_hostname = 'example.com';
    exConfig.slicer_port = random(8000, 60000);
    exConfig.ex_id = newId('ex-id');
    exConfig.job_id = newId('job-id');
    return exConfig;
}

/**
 * Create a new Execution Context
 * @deprecated use the new WorkerExecutionContext and SlicerExecutionContext
*/
export function newTestExecutionContext(type: i.Assignment, config: i.ExecutionConfig): i.LegacyExecutionContext {
    if (type === 'execution_controller') {
        return {
            config,
            queue: [],
            reader: null,
            slicer: () => {},
            dynamicQueueLength: false,
            queueLength: 10000,
            reporter: null,
        };
    }

    return {
        config,
        queue: config.operations.map(() => () => {}),
        reader: () => {},
        slicer: () => {},
        dynamicQueueLength: false,
        queueLength: 10000,
        reporter: null,
    };
}

interface ClientFactoryFns {
    [prop: string]: i.ClientFactoryFn;
}

export interface CachedClients {
    [prop: string]: any;
}

export interface TestClientConfig {
    type: string;
    create: i.ClientFactoryFn;
    config?: object;
    endpoint?: string;
}

const _cachedClients = new WeakMap<i.Context, CachedClients>();
const _availableClients = new WeakMap<i.Context, ClientFactoryFns>();

export interface TestContextAPIs extends i.ContextAPIs {
    setTestClients(clients: TestClientConfig[]): void;
}

function newTestContextAPIs(testName: string, context: i.Context): TestContextAPIs {
    const events = new EventEmitter();
    _cachedClients.set(context, {});
    _availableClients.set(context, {});

    type opts = {
        type: string;
        endpoint: string;
    };

    function getKey({ type, endpoint }: opts) {
        if (!isString(type)) throw new Error('A type must be specified when registering a Client');
        return `${type}:${endpoint}`;
    }

    function setConnectorConfig<T extends Object>({ type, endpoint }: opts, config: T, override = true): T {
        const { connectors } = context.sysconfig.terafoundation;
        if (connectors[type] == null) connectors[type] = {};
        if (connectors[type][endpoint] == null) {
            connectors[type][endpoint] = config;
        } else if (override) {
            connectors[type][endpoint] = config;
        }
        return connectors[type][endpoint];
    }

    const apis: TestContextAPIs = {
        foundation: {
            makeLogger(...params: any[]): i.Logger {
                return debugLogger(testName, ...params);
            },
            getConnection(options: i.ConnectionConfig): { client: any } {
                const { type, endpoint, cached } = options;

                const key = getKey(options);
                const cachedClients: ClientFactoryFns = _cachedClients.get(context) as CachedClients;

                if (cached && cachedClients[key] != null) {
                    return { client: cachedClients[key] };
                }

                const clients: ClientFactoryFns = _availableClients.get(context) as ClientFactoryFns;

                const create = clients[key];
                if (!create) throw new Error(`No client was found for connection "${type}:${endpoint}"`);
                if (!isFunction(create)) {
                    const actual = kindOf(create);
                    throw new Error(`Registered Client for connection "${type}:${endpoint}" is not a function, got ${actual}`);
                }

                const config = setConnectorConfig(options, {});

                const client = create(config, context.logger, options);

                cachedClients[key] = client;

                _cachedClients.set(context, cachedClients);

                return { client };
            },
            getSystemEvents(): EventEmitter {
                return events;
            },
        },
        registerAPI(namespace: string, apis: any): void {
            this[namespace] = apis;
        },
        setTestClients(clients: TestClientConfig[] = []) {
            clients.forEach((clientConfig) => {
                const {
                    create,
                    type,
                    endpoint = 'default',
                    config = {}
                } = clientConfig;

                const key = getKey({ type, endpoint });

                const clients = _availableClients.get(context) as ClientFactoryFns;

                clients[key] = create;

                setConnectorConfig({ type, endpoint }, config, true);

                _availableClients.set(context, clients);
            });
        }
    };
    return apis;
}

export class TestContext implements i.Context {
    logger: i.Logger;
    sysconfig: i.SysConfig;
    apis: TestContextAPIs|i.WorkerContextAPIs|i.ContextAPIs;
    foundation: i.LegacyFoundationApis;
    name: string;
    assignment: i.Assignment = 'worker';
    platform: string = process.platform;
    arch: string = process.arch;

    constructor(testName: string, assignment?: i.Assignment) {
        this.name = testName;
        if (assignment) {
            this.assignment = assignment;
        }

        this.logger = debugLogger(testName);

        this.sysconfig = {
            terafoundation: {
                connectors: {
                    elasticsearch: {
                        default: {}
                    }
                },
            },
            teraslice: {
                action_timeout: 10000,
                analytics_rate: 10000,
                assets_directory: path.join(process.cwd(), 'assets'),
                cluster_manager_type: i.ClusterManagerType.Native,
                hostname: 'localhost',
                index_rollover_frequency: {
                    analytics: i.RolloverFrequency.Yearly,
                    state: i.RolloverFrequency.Monthly,
                },
                master_hostname: 'localhost',
                master: false,
                name: testName,
                network_latency_buffer: 100,
                node_disconnect_timeout: 5000,
                node_state_interval: 5000,
                port: 55678,
                shutdown_timeout: 10000,
                slicer_allocation_attempts: 1,
                slicer_port_range: '55679:56678',
                slicer_timeout: 10000,
                state: {
                    connection: 'default'
                },
                worker_disconnect_timeout: 3000,
                workers: 1,
            },
        };

        this.apis = newTestContextAPIs(testName, this);

        this.foundation = {
            getConnection: this.apis.foundation.getConnection,
            getEventEmitter: this.apis.foundation.getSystemEvents,
            makeLogger: this.apis.foundation.makeLogger,
        };
    }
}
